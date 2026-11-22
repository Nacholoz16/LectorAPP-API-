/**
 * Borrado DEFINITIVO de una cuenta y de todos sus datos (tarea 2.2; la 2.3 lo reutiliza desde la
 * web con email + código).
 *
 * `deleteUserCompletely(userId, conn)` no sabe CÓMO se autenticó la petición (contraseña en la app,
 * código por correo en la web): solo borra. Quien lo llama decide si la persona tiene derecho a
 * hacerlo y abre la transacción, para poder sumar sus propios pasos (revocar el token actual,
 * marcar el código como usado…) y que todo se confirme o se revierta junto.
 *
 * No depende de `ON DELETE CASCADE`: la BD de tests no tiene esas FKs y en producción las tablas
 * más antiguas se crearon con scripts distintos. Cada tabla se borra de forma explícita; las FKs que
 * existan solo son una segunda red.
 *
 * ── PUNTO DE EXTENSIÓN ──────────────────────────────────────────────────────────────────────────
 * Toda tabla nueva con filas de un usuario DEBE añadirse a `USER_DATA_STEPS` (o a
 * `ANONYMIZE_STEPS` si es un registro que se conserva sin identificar a la persona). El test E2E
 * "no queda ningún rastro" recorre information_schema y falla si una columna que referencia
 * usuarios conserva filas del borrado. Pendientes previstas:
 *   - 3.1 `reports`: borrar las denuncias HECHAS (reporter_id) y decidir qué pasa con las
 *     RECIBIDAS (target_type 'user' = la cuenta, 'reading' = sus lecturas).
 *   - 3.2 `user_blocks`: borrar donde blocker_id = usuario O blocked_id = usuario.
 *   - 4.x `suspensions` / `suspension_appeals` / `user_notices` (user_id) y `deletion_requests`.
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 */

// Subconsulta reutilizada: ids de las lecturas del usuario. Va dentro de cada DELETE (no se leen
// antes en JS) para que lo que se borra sea exactamente lo que hay dentro de la transacción.
const USER_LOGS = '(SELECT id FROM reading_logs WHERE user_id = ?)';

/**
 * Filas que se BORRAN, en este orden (hijos antes que padres). Cada `?` recibe el id del usuario.
 * Los libros (`books`) son un catálogo compartido y NO se tocan.
 */
const USER_DATA_STEPS = [
    // "Me gusta" que dio Y los que recibieron sus lecturas (si no, quedarían colgando de lecturas
    // que ya no existen).
    { table: 'reading_likes', where: `user_id = ? OR reading_log_id IN ${USER_LOGS}` },
    // Sesiones del cronómetro (por usuario y por lectura, por si alguna quedara cruzada).
    { table: 'reading_sessions', where: `user_id = ? OR reading_log_id IN ${USER_LOGS}` },
    { table: 'reading_goals', where: 'user_id = ?' },
    // Lecturas con sus reseñas, fechas y página actual.
    { table: 'reading_logs', where: 'user_id = ?' },
    // Sesiones abiertas en cualquier dispositivo (sin refresh no se puede renovar el acceso).
    { table: 'refresh_tokens', where: 'user_id = ?' },
    // Códigos de recuperación de contraseña.
    { table: 'password_resets', where: 'user_id = ?' },
];

/**
 * Registros que se CONSERVAN pero dejan de identificar a la persona. La auditoría de moderación
 * (admin_actions) explica qué hizo cada admin y cuándo; borrar la fila la dejaría incompleta, pero
 * el vínculo con la cuenta eliminada (como admin que actuó o como objetivo de la acción) se rompe.
 * Van ANTES de borrar las lecturas: necesitan la subconsulta de sus ids.
 */
const ANONYMIZE_STEPS = [
    { sql: 'UPDATE admin_actions SET admin_id = NULL WHERE admin_id = ?' },
    {
        sql: `UPDATE admin_actions SET target_id = NULL
              WHERE (target_type = 'user' AND target_id = ?)
                 OR (target_type = 'reading' AND target_id IN ${USER_LOGS})`,
    },
];

const paramsFor = (sql, userId) => Array((sql.match(/\?/g) || []).length).fill(userId);

/**
 * Borra la cuenta `userId` y todo lo que la referencia, dentro de la transacción de `conn`.
 * Quien llama debe haber bloqueado antes la fila del usuario (`SELECT … FOR UPDATE`) para que dos
 * borrados simultáneos se ejecuten uno detrás del otro.
 *
 * @param {number} userId
 * @param {object} conn Conexión con una transacción abierta (obligatoria: nunca se borra a medias).
 * @returns {Promise<boolean>} true si la cuenta existía y se borró.
 */
const deleteUserCompletely = async (userId, conn) => {
    if (!conn) throw new Error('deleteUserCompletely necesita una conexión con transacción abierta');

    for (const { sql } of ANONYMIZE_STEPS) {
        await conn.execute(sql, paramsFor(sql, userId));
    }
    for (const { table, where } of USER_DATA_STEPS) {
        await conn.execute(`DELETE FROM ${table} WHERE ${where}`, paramsFor(where, userId));
    }
    const [result] = await conn.execute('DELETE FROM users WHERE id = ?', [userId]);
    return result.affectedRows === 1;
};

module.exports = {
    deleteUserCompletely,
    // Exportadas para el test "ningún rastro" y para documentar el punto de extensión.
    USER_DATA_TABLES: USER_DATA_STEPS.map((s) => s.table),
};
