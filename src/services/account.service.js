const bcrypt = require('bcryptjs');
const db = require('../config/db');
const UserModel = require('../models/user.model');
const ReadingModel = require('../models/reading.model');
const { CURRENT_TERMS_VERSION, termsStatus } = require('../config/terms');
const {
    ConflictError,
    ForbiddenError,
    InvalidPasswordError,
    TermsRequiredError,
    UnauthorizedError,
} = require('../utils/errors');

// `protect`/`authenticate` ya comprobaron que el usuario existe; si se borró entre medio, la
// sesión no vale.
const USER_GONE_MESSAGE = 'Usuario no encontrado con este token';

/**
 * Ejecuta `work(conn)` en una transacción. (Copia local del helper de reading.service: importarlo
 * de ahí crearía un ciclo, porque reading.service usa este servicio para los términos.)
 */
const withTransaction = async (work) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const result = await work(conn);
        await conn.commit();
        return result;
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
};

/** Operaciones sobre la cuenta del usuario autenticado (`/api/account`). */
class AccountService {
    /**
     * Acepta la versión VIGENTE de los términos (el cliente no elige versión: solo se puede
     * aceptar la que está publicada). Idempotente: repetirla conserva la fecha original.
     */
    async acceptTerms(userId) {
        const row = await UserModel.acceptTerms(userId, CURRENT_TERMS_VERSION);
        // `protect` ya comprobó que el usuario existe; si se borró entre medio, la sesión no vale.
        if (!row) throw new UnauthorizedError(USER_GONE_MESSAGE);
        return {
            ...termsStatus(row.terms_version),
            terms_accepted_at: row.terms_accepted_at,
        };
    }

    /**
     * Lanza 403 TERMS_REQUIRED si el usuario no aceptó la versión vigente. Se usa antes de
     * crear contenido público (lecturas públicas); el contenido privado no lo necesita.
     */
    async assertTermsAccepted(userId) {
        const version = await UserModel.getTermsVersion(userId);
        if (version !== CURRENT_TERMS_VERSION) throw new TermsRequiredError();
    }

    // --- Desactivar / reactivar (tarea 2.1, decisión D7) ---

    /**
     * Estado de la cuenta y conteos para que la app explique ANTES de confirmar qué va a pasar:
     * "Tus N lecturas públicas pasarán a privadas" / "Tus N lecturas que eran públicas volverán".
     */
    async getStatus(userId) {
        const [row, counts] = await Promise.all([
            UserModel.getStatus(userId),
            ReadingModel.countVisibility(userId),
        ]);
        if (!row) throw new UnauthorizedError(USER_GONE_MESSAGE);
        return {
            status: row.status,
            status_changed_at: row.status_changed_at,
            ...counts,
        };
    }

    /**
     * Desactiva la cuenta (confirmada con la contraseña). En UNA transacción: guarda la
     * visibilidad de cada lectura en `public_before_deactivation`, las deja todas privadas y
     * marca la cuenta. Desactivar una cuenta ya desactivada → 409 sin tocar nada: así un doble
     * envío nunca sobrescribe la visibilidad guardada con los ceros de la primera desactivación.
     */
    async deactivate(userId, password) {
        const user = await UserModel.findCredentialsById(userId);
        if (!user) throw new UnauthorizedError(USER_GONE_MESSAGE);
        this._assertCanDeactivate(user.status);

        // bcrypt fuera de la transacción: tarda ~100 ms y no debe retener bloqueos.
        if (!(await bcrypt.compare(password, user.password_hash))) {
            throw new InvalidPasswordError();
        }

        return withTransaction(async (conn) => {
            // Se vuelve a leer CON bloqueo: dos peticiones simultáneas pasan la comprobación de
            // arriba, pero aquí la segunda espera a la primera y ve 'deactivated'.
            const current = await UserModel.getStatus(userId, conn);
            if (!current) throw new UnauthorizedError(USER_GONE_MESSAGE);
            this._assertCanDeactivate(current.status);

            const { public_readings: hidden } = await ReadingModel.countVisibility(userId, conn);
            await ReadingModel.hideAllForDeactivation(userId, conn);
            await UserModel.setStatus(userId, 'deactivated', conn);
            return { status: 'deactivated', hidden_readings: hidden };
        });
    }

    /**
     * Reactiva la cuenta: cada lectura vuelve a la visibilidad que tenía al desactivar, salvo las
     * bloqueadas por moderación (D4), que siguen privadas. No exige aceptar los términos vigentes:
     * es restaurar contenido que ya era público, no publicar nada nuevo (si los términos cambiaron,
     * se pedirán al crear o editar contenido público, como a cualquier cuenta).
     * Devuelve cuántas volvieron a ser públicas.
     */
    async reactivate(userId) {
        return withTransaction(async (conn) => {
            const current = await UserModel.getStatus(userId, conn);
            if (!current) throw new UnauthorizedError(USER_GONE_MESSAGE);
            if (current.status === 'active') throw new ConflictError('Tu cuenta ya está activa.');
            // Una suspensión (D5) no se levanta por cuenta propia: solo un admin o una apelación.
            if (current.status !== 'deactivated') {
                throw new ForbiddenError('No puedes reactivar esta cuenta.');
            }

            const { restorable_readings: restored } = await ReadingModel.countVisibility(userId, conn);
            await ReadingModel.restoreAfterDeactivation(userId, conn);
            await UserModel.setStatus(userId, 'active', conn);
            return { status: 'active', restored_readings: restored };
        });
    }

    _assertCanDeactivate(status) {
        if (status === 'deactivated') throw new ConflictError('Tu cuenta ya está desactivada.');
        if (status !== 'active') throw new ForbiddenError('No puedes desactivar esta cuenta.');
    }
}

module.exports = new AccountService();
