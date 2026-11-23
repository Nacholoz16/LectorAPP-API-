const db = require('../config/db');

/**
 * Tope POR CUENTA para los códigos de 6 dígitos que llegan por correo (recuperar la contraseña y
 * eliminar la cuenta desde la web). Revisión de la tarea 2.3.
 *
 * Los 5 intentos por código no bastan: cada código nuevo empieza con 0 intentos, y repartiendo las
 * peticiones entre muchas IPs (el rate limit es por IP) se podían probar ~7.200 códigos al día
 * contra una misma cuenta. Con este tope, en cualquier ventana de 24 h una cuenta admite como
 * máximo MAX_CODES códigos emitidos y MAX_FAILED intentos fallidos EN TOTAL (sumando todos sus
 * códigos de esa ventana): ~10 intentos al día ⇒ adivinar un código es ~0,4 % al año.
 *
 * Al llegar al tope no se emiten más códigos y no se acepta ninguno (ni el correcto) hasta que la
 * ventana avance. Las respuestas públicas NO cambian: el mismo 200 al pedir y el mismo 400
 * genérico al confirmar, así el tope no revela qué correos tienen cuenta.
 *
 * Cada flujo usa su propia tabla: agotar los intentos de uno no bloquea el otro.
 */
const WINDOW_HOURS = 24;
const MAX_CODES = 5;
const MAX_FAILED = 10;

// Lista cerrada: el nombre de la tabla va interpolado en el SQL.
const TABLES = new Set(['password_resets', 'deletion_requests']);

async function usageInWindow(table, userId, conn) {
    if (!TABLES.has(table)) throw new Error(`Tabla de códigos desconocida: ${table}`);
    const [rows] = await conn.execute(
        `SELECT COUNT(*) AS codes, COALESCE(SUM(attempts), 0) AS failed FROM ${table}
         WHERE user_id = ? AND created_at > (NOW() - INTERVAL ? HOUR)`,
        [userId, WINDOW_HOURS]
    );
    return { codes: Number(rows[0].codes), failed: Number(rows[0].failed) };
}

/** ¿Se puede emitir otro código a esta cuenta? (además del enfriamiento de 60 s de cada flujo) */
async function canIssueCode(table, userId, conn = db) {
    const { codes, failed } = await usageInWindow(table, userId, conn);
    return codes < MAX_CODES && failed < MAX_FAILED;
}

/** ¿Se puede probar un código de esta cuenta? (además de los 5 intentos de cada código) */
async function canTryCode(table, userId, conn = db) {
    const { failed } = await usageInWindow(table, userId, conn);
    return failed < MAX_FAILED;
}

module.exports = { canIssueCode, canTryCode, WINDOW_HOURS, MAX_CODES, MAX_FAILED };
