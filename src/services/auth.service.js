const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const UserModel = require('../models/user.model');
const db = require('../config/db');
const { signToken, hashToken } = require('../utils/tokens');
const { ConflictError, UnauthorizedError, ValidationError, isDuplicateEntry } = require('../utils/errors');
const { sendMail } = require('../utils/mailer');
const logger = require('../utils/logger');

const BCRYPT_ROUNDS = 10;

// Hash ficticio para comparar cuando el usuario no existe: así el login tarda lo mismo
// exista o no la cuenta, y no se pueden enumerar usuarios midiendo tiempos de respuesta.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('dummy-password-for-timing-safety', BCRYPT_ROUNDS);

// Recuperación de contraseña
const RESET_CODE_TTL_MINUTES = 15;
const RESET_MAX_ATTEMPTS = 5;
const RESET_RESEND_COOLDOWN_SECONDS = 60;
const INVALID_CODE_MESSAGE = 'El código no es válido o ya venció. Pide uno nuevo.';

/**
 * El código nunca se guarda en claro: HMAC con el secreto del servidor y el id del usuario.
 * (Un código de 6 dígitos se adivinaría con fuerza bruta offline si se filtrara solo su hash;
 * con HMAC hace falta además el JWT_SECRET. Online lo protege el límite de intentos.)
 */
const hashResetCode = (userId, code) =>
    crypto.createHmac('sha256', process.env.JWT_SECRET).update(`${userId}:${code}`).digest('hex');

const resetEmail = (username, code) => {
    const text =
        `Hola, ${username}:\n\n` +
        `Tu código para crear una contraseña nueva en LectorApp es:\n\n    ${code}\n\n` +
        `Vence en ${RESET_CODE_TTL_MINUTES} minutos. Si no lo pediste tú, ignora este correo: ` +
        `tu contraseña actual sigue funcionando.\n\n— LectorApp`;
    const html = `<div style="font-family:Arial,sans-serif;color:#3D4042;max-width:420px">
<p>Hola, ${username}:</p>
<p>Tu código para crear una contraseña nueva en <b>LectorApp</b> es:</p>
<p style="font-size:30px;letter-spacing:8px;font-weight:bold;color:#4F7A70;margin:20px 0">${code}</p>
<p>Vence en ${RESET_CODE_TTL_MINUTES} minutos. Si no lo pediste tú, ignora este correo: tu contraseña actual sigue funcionando.</p>
<p style="color:#6B6F72">— LectorApp</p></div>`;
    return { subject: `Tu código de LectorApp: ${code}`, text, html };
};

class AuthService {
    /** `data` ya viene validado y normalizado (email en minúsculas) por registerSchema. */
    async registerUser({ username, email, password }) {
        const [emailExists, usernameExists] = await Promise.all([
            UserModel.findByEmail(email),
            UserModel.findByUsername(username),
        ]);
        if (emailExists) throw new ConflictError('El email ya está registrado');
        if (usernameExists) throw new ConflictError('El nombre de usuario ya está ocupado');

        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

        let userId;
        try {
            userId = await UserModel.create({ username, email, passwordHash });
        } catch (error) {
            // Dos registros simultáneos con el mismo email/username: lo resuelve el UNIQUE de la BD.
            if (isDuplicateEntry(error)) {
                throw new ConflictError('El email o nombre de usuario ya está registrado');
            }
            throw error;
        }

        return {
            user: { id: userId, username, email },
            token: signToken(userId),
        };
    }

    async loginUser({ email, username, password }) {
        const user = email
            ? await UserModel.findByEmail(email)
            : await UserModel.findByUsername(username);

        // Siempre se ejecuta bcrypt.compare (ver DUMMY_PASSWORD_HASH).
        const validPassword = await bcrypt.compare(
            password,
            user ? user.password_hash : DUMMY_PASSWORD_HASH
        );

        if (!user || !validPassword) {
            throw new UnauthorizedError('Credenciales inválidas');
        }

        return {
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                avatar: user.avatar_url,
            },
            token: signToken(user.id),
        };
    }

    /**
     * Paso 1: pedir un código. Responde SIEMPRE lo mismo (exista o no el email) para no
     * revelar qué correos están registrados; el correo se envía sin esperar a que salga,
     * así el tiempo de respuesta tampoco lo delata.
     */
    async requestPasswordReset({ email }) {
        const user = await UserModel.findByEmail(email);
        if (!user) return;

        // No reenviar si se pidió uno hace menos de un minuto (evita usar la API para spamear).
        const [recent] = await db.execute(
            `SELECT 1 FROM password_resets
             WHERE user_id = ? AND created_at > (NOW() - INTERVAL ? SECOND) LIMIT 1`,
            [user.id, RESET_RESEND_COOLDOWN_SECONDS]
        );
        if (recent.length > 0) return;

        const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');

        // Un solo código vigente por usuario: los anteriores dejan de servir.
        await db.execute(
            'UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL',
            [user.id]
        );
        await db.execute(
            `INSERT INTO password_resets (user_id, code_hash, expires_at)
             VALUES (?, ?, NOW() + INTERVAL ? MINUTE)`,
            [user.id, hashResetCode(user.id, code), RESET_CODE_TTL_MINUTES]
        );

        const mail = resetEmail(user.username, code);
        sendMail({ to: user.email, ...mail }).catch((error) =>
            logger.error({ err: error, userId: user.id }, 'No se pudo enviar el correo de recuperación')
        );
    }

    /**
     * Paso 2: código + contraseña nueva. Si todo es correcto cambia la contraseña, invalida
     * TODAS las sesiones anteriores (password_changed_at) y devuelve una sesión nueva.
     */
    async resetPassword({ email, code, password }) {
        const user = await UserModel.findByEmail(email);
        if (!user) throw new ValidationError(INVALID_CODE_MESSAGE);

        const [rows] = await db.execute(
            `SELECT id, code_hash, attempts FROM password_resets
             WHERE user_id = ? AND used_at IS NULL AND expires_at > NOW()
             ORDER BY id DESC LIMIT 1`,
            [user.id]
        );
        const reset = rows[0];
        if (!reset || reset.attempts >= RESET_MAX_ATTEMPTS) {
            throw new ValidationError(INVALID_CODE_MESSAGE);
        }

        const expected = Buffer.from(reset.code_hash, 'hex');
        const given = Buffer.from(hashResetCode(user.id, code), 'hex');
        if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
            await db.execute('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?', [reset.id]);
            throw new ValidationError(INVALID_CODE_MESSAGE);
        }

        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            // Los JWT emitidos antes de este momento dejan de valer (ver auth.middleware).
            // Se guarda en segundos Unix (como el `iat` del JWT): no depende de zonas horarias.
            await conn.execute(
                'UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?',
                [passwordHash, Math.floor(Date.now() / 1000), user.id]
            );
            await conn.execute(
                'UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL',
                [user.id]
            );
            await conn.commit();
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }

        return {
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                avatar: user.avatar_url,
            },
            token: signToken(user.id),
        };
    }

    /** Revoca un token ya verificado por el middleware `protect`. */
    async logout(token) {
        const { exp } = jwt.decode(token);
        const expiresAt = new Date(exp * 1000);

        await db.execute(
            'INSERT IGNORE INTO token_blacklist (token, expires_at) VALUES (?, ?)',
            [hashToken(token), expiresAt]
        );

        return { success: true };
    }
}

module.exports = new AuthService();
