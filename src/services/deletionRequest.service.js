const crypto = require('crypto');
const db = require('../config/db');
const UserModel = require('../models/user.model');
const { deleteUserCompletely } = require('./accountDeletion.service');
const { canIssueCode, canTryCode } = require('./emailCodeGuard');
const { ValidationError } = require('../utils/errors');
const { sendMail } = require('../utils/mailer');
const logger = require('../utils/logger');

/**
 * Eliminar la cuenta DESDE LA WEB, sin sesión (tarea 2.3; Google Play exige un enlace web para
 * pedir el borrado). Dos pasos, con la misma protección que "Olvidé mi contraseña":
 *
 *   1. `requestDeletion({ email })`: si la cuenta existe (en cualquier estado: activa,
 *      desactivada o suspendida) se envía un código de 6 dígitos. La respuesta es SIEMPRE la
 *      misma y no espera al correo, así ni el contenido ni el tiempo delatan si el email existe.
 *   2. `confirmDeletion({ email, code })`: valida el código y, en la MISMA transacción, borra la
 *      cuenta con `deleteUserCompletely` (el mismo borrado que la app, 2.2).
 *
 * Por qué `deletion_requests.user_id` y no `email_hash` (como decía el borrador del backlog):
 * - Solo se crean filas para cuentas que existen (para un email desconocido no se guarda nada),
 *   así que un hash del email no aporta nada que el id no dé.
 * - Con `user_id` la fila entra en la limpieza central de `accountDeletion.service`: al borrar la
 *   cuenta desaparece también su solicitud (un `email_hash` sobreviviría al borrado y seguiría
 *   identificando a la persona, que es justo lo que el borrado debe evitar).
 * - El HMAC del código ya va atado al id (`account-deletion:<id>:<código>`), como en
 *   password_resets: si alguien registra de nuevo el mismo email, el código viejo no le sirve.
 */

const DELETION_CODE_TTL_MINUTES = 15;
const DELETION_MAX_ATTEMPTS = 5;
const DELETION_RESEND_COOLDOWN_SECONDS = 60;
// Mismo texto que un código de recuperación inválido: no se distingue "no existe la cuenta",
// "no hay código", "código vencido", "demasiados intentos" ni "código incorrecto".
const INVALID_CODE_MESSAGE = 'El código no es válido o ya venció. Pide uno nuevo.';

/**
 * El código nunca se guarda en claro: HMAC con el secreto del servidor. El prefijo
 * `account-deletion:` separa este uso del de recuperación de contraseña (`<id>:<código>`): aunque
 * dos filas de tablas distintas tuvieran el mismo código, sus hashes no coinciden.
 */
const hashDeletionCode = (userId, code) =>
    crypto
        .createHmac('sha256', process.env.JWT_SECRET)
        .update(`account-deletion:${userId}:${code}`)
        .digest('hex');

/**
 * Correo claro y sin enlaces (solo el código): qué se borra, que no se puede deshacer y qué hacer
 * si no lo pidió. El código NO va en el asunto (a diferencia del de recuperación): el asunto se ve
 * en la notificación del móvil bloqueado y esta acción es irreversible.
 * `username` es seguro en HTML: el registro solo admite [a-zA-Z0-9_.-].
 */
const deletionEmail = (username, code) => {
    const text =
        `Hola, ${username}:\n\n` +
        'Alguien (esperamos que tú) pidió eliminar tu cuenta de LectorApp.\n\n' +
        `Tu código para confirmarlo es:\n\n    ${code}\n\n` +
        `Vence en ${DELETION_CODE_TTL_MINUTES} minutos. Escríbelo en la página donde lo pediste.\n\n` +
        'Si confirmas, se borrarán para siempre tu cuenta, tus lecturas con sus reseñas, tus ' +
        'sesiones de lectura, tus retos anuales y tus "me gusta". No se puede deshacer.\n\n' +
        'Si no lo pediste tú, ignora este correo: tu cuenta sigue intacta y nadie puede ' +
        'eliminarla sin este código.\n\n— LectorApp';
    const html = `<div style="font-family:Arial,sans-serif;color:#3D4042;max-width:440px">
<p>Hola, ${username}:</p>
<p>Alguien (esperamos que tú) pidió eliminar tu cuenta de <b>LectorApp</b>.</p>
<p>Tu código para confirmarlo es:</p>
<p style="font-size:30px;letter-spacing:8px;font-weight:bold;color:#4F7A70;margin:20px 0">${code}</p>
<p>Vence en ${DELETION_CODE_TTL_MINUTES} minutos. Escríbelo en la página donde lo pediste.</p>
<p>Si confirmas, se borrarán <b>para siempre</b> tu cuenta, tus lecturas con sus reseñas, tus sesiones de lectura, tus retos anuales y tus "me gusta". No se puede deshacer.</p>
<p>Si no lo pediste tú, ignora este correo: tu cuenta sigue intacta y nadie puede eliminarla sin este código.</p>
<p style="color:#6B6F72">— LectorApp</p></div>`;
    return { subject: 'Código para eliminar tu cuenta de LectorApp', text, html };
};

class DeletionRequestService {
    /** Paso 1. `email` ya viene normalizado (trim + minúsculas) por el validador. */
    async requestDeletion({ email }) {
        const user = await UserModel.findByEmail(email);
        if (!user) return;

        // Un código por minuto por cuenta: evita usar la API para llenar el buzón de alguien.
        const [recent] = await db.execute(
            `SELECT 1 FROM deletion_requests
             WHERE user_id = ? AND created_at > (NOW() - INTERVAL ? SECOND) LIMIT 1`,
            [user.id, DELETION_RESEND_COOLDOWN_SECONDS]
        );
        if (recent.length > 0) return;
        // Tope por cuenta en 24 h (códigos emitidos e intentos fallidos): ver emailCodeGuard.
        if (!(await canIssueCode('deletion_requests', user.id))) return;

        const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');

        // Un solo código vigente por cuenta: pedir otro invalida los anteriores.
        await db.execute(
            'UPDATE deletion_requests SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL',
            [user.id]
        );
        await db.execute(
            `INSERT INTO deletion_requests (user_id, code_hash, expires_at)
             VALUES (?, ?, NOW() + INTERVAL ? MINUTE)`,
            [user.id, hashDeletionCode(user.id, code), DELETION_CODE_TTL_MINUTES]
        );

        // Sin `await`: el envío por SMTP tarda cientos de ms y delataría que la cuenta existe.
        // Las consultas de arriba son de pocos ms (índice por user_id), en el ruido de la red.
        sendMail({ to: user.email, ...deletionEmail(user.username, code) }).catch((error) =>
            logger.error({ err: error, userId: user.id }, 'No se pudo enviar el correo de eliminación de cuenta')
        );
    }

    /**
     * Paso 2. Todo en UNA transacción con la fila del usuario y la del código bloqueadas: dos
     * confirmaciones simultáneas no pueden gastar más intentos de los permitidos ni borrar dos
     * veces (la segunda espera y ya no encuentra la cuenta → 400 genérico).
     */
    async confirmDeletion({ email, code }) {
        const user = await UserModel.findByEmail(email);
        if (!user) throw new ValidationError(INVALID_CODE_MESSAGE);

        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            // Mismo orden de bloqueo que DELETE /account (usuario primero): sin interbloqueos.
            const current = await UserModel.getStatus(user.id, conn);
            if (!current) throw new ValidationError(INVALID_CODE_MESSAGE);
            // Tope por cuenta en 24 h: con la fila del usuario bloqueada, la suma es exacta aunque
            // lleguen confirmaciones simultáneas desde muchas IPs.
            if (!(await canTryCode('deletion_requests', user.id, conn))) {
                throw new ValidationError(INVALID_CODE_MESSAGE);
            }

            const [rows] = await conn.execute(
                `SELECT id, code_hash, attempts FROM deletion_requests
                 WHERE user_id = ? AND used_at IS NULL AND expires_at > NOW()
                 ORDER BY id DESC LIMIT 1 FOR UPDATE`,
                [user.id]
            );
            const pending = rows[0];
            if (!pending || pending.attempts >= DELETION_MAX_ATTEMPTS) {
                throw new ValidationError(INVALID_CODE_MESSAGE);
            }

            const expected = Buffer.from(pending.code_hash, 'hex');
            const given = Buffer.from(hashDeletionCode(user.id, code), 'hex');
            if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
                // El intento fallido se CONFIRMA antes de responder (si no, el rollback lo anularía).
                await conn.execute(
                    'UPDATE deletion_requests SET attempts = attempts + 1 WHERE id = ?',
                    [pending.id]
                );
                await conn.commit();
                throw new ValidationError(INVALID_CODE_MESSAGE);
            }

            // Vale para cualquier estado de la cuenta (también suspendida: Google lo exige).
            // Borra también sus filas de deletion_requests, refresh_tokens, password_resets…
            await deleteUserCompletely(user.id, conn);
            await conn.commit();
            return { deleted: true };
        } catch (error) {
            // Si ya se hizo commit (intento fallido), rollback no hace nada.
            await conn.rollback().catch(() => {});
            throw error;
        } finally {
            conn.release();
        }
    }
}

module.exports = new DeletionRequestService();
