const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const UserModel = require('../models/user.model');
const db = require('../config/db');
const {
    signToken,
    verifyToken,
    hashToken,
    generateRefreshToken,
    REFRESH_TOKEN_TTL_DAYS,
} = require('../utils/tokens');
const { ConflictError, UnauthorizedError, ValidationError, isDuplicateEntry } = require('../utils/errors');
const { sendMail } = require('../utils/mailer');
const logger = require('../utils/logger');

const BCRYPT_ROUNDS = 10;

// Hash ficticio para comparar cuando el usuario no existe: así el login tarda lo mismo
// exista o no la cuenta, y no se pueden enumerar usuarios midiendo tiempos de respuesta.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('dummy-password-for-timing-safety', BCRYPT_ROUNDS);


/**
 * Emite una sesión: token de acceso (JWT, 30 min) + refresh token (opaco, 60 días, rotativo).
 * `familyId` agrupa los refresh tokens que nacen de un mismo inicio de sesión: si se detecta
 * la reutilización de uno ya rotado (señal de robo), se revoca la familia completa.
 */
async function issueSession(userId, { conn = db, familyId = crypto.randomUUID() } = {}) {
    const refreshToken = generateRefreshToken();
    const [result] = await conn.execute(
        `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at)
         VALUES (?, ?, ?, NOW() + INTERVAL ? DAY)`,
        [userId, hashToken(refreshToken), familyId, REFRESH_TOKEN_TTL_DAYS]
    );
    return {
        session: { token: signToken(userId), refresh_token: refreshToken },
        refreshId: result.insertId,
    };
}

const SESSION_EXPIRED_MESSAGE = 'Tu sesión expiró. Inicia sesión de nuevo.';

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

        const { session } = await issueSession(userId);
        return {
            user: { id: userId, username, email },
            ...session,
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

        const { session } = await issueSession(user.id);
        return {
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                avatar: user.avatar_url,
            },
            ...session,
        };
    }

    /**
     * Renueva la sesión con un refresh token (rotación: el usado queda revocado y se entrega
     * uno nuevo de la misma familia). Si llega uno YA rotado, alguien lo copió: se revoca toda
     * la familia y ambos —el ladrón y el usuario legítimo— deben volver a iniciar sesión.
     */
    async refresh({ refresh_token: refreshToken }) {
        const conn = await db.getConnection();
        let reuseDetected = false;
        try {
            await conn.beginTransaction();
            const [rows] = await conn.execute(
                `SELECT id, user_id, family_id, revoked_at, replaced_by_id, expires_at > NOW() AS alive
                 FROM refresh_tokens WHERE token_hash = ? FOR UPDATE`,
                [hashToken(refreshToken)]
            );
            const current = rows[0];

            if (!current || !current.alive || current.revoked_at) {
                if (current && current.revoked_at && current.replaced_by_id) {
                    reuseDetected = true;
                    await conn.execute(
                        'UPDATE refresh_tokens SET revoked_at = NOW() WHERE family_id = ? AND revoked_at IS NULL',
                        [current.family_id]
                    );
                }
                await conn.commit();
                if (reuseDetected) {
                    logger.warn({ userId: current.user_id }, 'Refresh token reutilizado: familia revocada');
                }
                throw new UnauthorizedError(SESSION_EXPIRED_MESSAGE);
            }

            const user = await UserModel.findById(current.user_id);
            if (!user) {
                await conn.commit();
                throw new UnauthorizedError(SESSION_EXPIRED_MESSAGE);
            }

            const { session, refreshId } = await issueSession(user.id, {
                conn,
                familyId: current.family_id,
            });
            await conn.execute(
                'UPDATE refresh_tokens SET revoked_at = NOW(), replaced_by_id = ? WHERE id = ?',
                [refreshId, current.id]
            );
            await conn.commit();
            return session;
        } catch (error) {
            // Si ya se hizo commit, rollback no hace nada.
            await conn.rollback().catch(() => {});
            throw error;
        } finally {
            conn.release();
        }
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
            // Cierra también las sesiones largas (refresh tokens) de todos los dispositivos.
            await conn.execute(
                'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL',
                [user.id]
            );
            await conn.commit();
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }

        const { session } = await issueSession(user.id);
        return {
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                avatar: user.avatar_url,
            },
            ...session,
        };
    }

    /**
     * Cierra sesión. Funciona con el token de acceso (aunque ya haya vencido no hace falta:
     * basta el refresh token) y/o con el refresh token, que se revoca junto a su familia.
     * Exige al menos uno de los dos válidos (no se puede "cerrar" una sesión inexistente).
     */
    async logout({ accessToken, refreshToken }) {
        let didSomething = false;

        if (accessToken) {
            try {
                verifyToken(accessToken);
                const { exp } = jwt.decode(accessToken);
                await db.execute(
                    'INSERT IGNORE INTO token_blacklist (token, expires_at) VALUES (?, ?)',
                    [hashToken(accessToken), new Date(exp * 1000)]
                );
                didSomething = true;
            } catch {
                // Token vencido o inválido: se ignora; puede bastar el refresh token.
            }
        }

        if (refreshToken) {
            const [rows] = await db.execute(
                'SELECT family_id FROM refresh_tokens WHERE token_hash = ?',
                [hashToken(refreshToken)]
            );
            if (rows[0]) {
                await db.execute(
                    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE family_id = ? AND revoked_at IS NULL',
                    [rows[0].family_id]
                );
                didSomething = true;
            }
        }

        if (!didSomething) throw new UnauthorizedError('No autorizado, falta token');
        return { success: true };
    }
}

module.exports = new AuthService();
