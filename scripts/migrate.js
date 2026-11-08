/**
 * Migración idempotente de seguridad/integridad (se puede ejecutar varias veces).
 *
 *   node scripts/migrate.js
 *
 * 1. Normaliza emails a minúsculas sin espacios (el registro ahora los normaliza).
 * 2. Convierte tokens de la blacklist guardados en claro a SHA-256 (el middleware ahora busca por hash;
 *    sin este paso, los tokens revocados antes del cambio volverían a ser válidos).
 * 3. UNIQUE(user_id, book_id) en reading_logs: un usuario no puede registrar el mismo libro dos veces.
 * 4. Índice en token_blacklist(expires_at) para la limpieza periódica,
 *    e índice (is_log_public, id) para el feed paginado por cursor.
 * 5. Avisa de usernames que no cumplen el nuevo formato (no los modifica).
 */
require('dotenv').config({ quiet: true });
const db = require('../src/config/db');

const indexExists = async (table, indexName) => {
    const [rows] = await db.query(
        `SELECT 1 FROM information_schema.statistics
         WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1`,
        [table, indexName]
    );
    return rows.length > 0;
};

async function migrate() {
    // 1. Emails
    const [emailResult] = await db.query(
        'UPDATE users SET email = LOWER(TRIM(email)) WHERE email <> LOWER(TRIM(email)) COLLATE utf8mb4_bin'
    );
    console.log(`[1] Emails normalizados: ${emailResult.affectedRows}`);

    // 2. Blacklist en claro -> SHA-256 (un hash hex mide exactamente 64 caracteres)
    const [tokenResult] = await db.query(
        'UPDATE IGNORE token_blacklist SET token = SHA2(token, 256) WHERE CHAR_LENGTH(token) <> 64'
    );
    console.log(`[2] Tokens de blacklist convertidos a hash: ${tokenResult.affectedRows}`);

    // 3. UNIQUE(user_id, book_id)
    if (await indexExists('reading_logs', 'uniq_user_book')) {
        console.log('[3] uniq_user_book ya existe');
    } else {
        const [dups] = await db.query(
            'SELECT user_id, book_id, COUNT(*) AS n FROM reading_logs GROUP BY user_id, book_id HAVING n > 1'
        );
        if (dups.length > 0) {
            console.error('[3] ABORTADO: hay lecturas duplicadas que resolver a mano antes de crear el UNIQUE:');
            console.table(dups);
            process.exitCode = 1;
        } else {
            await db.query('ALTER TABLE reading_logs ADD UNIQUE KEY uniq_user_book (user_id, book_id)');
            console.log('[3] uniq_user_book creado');
        }
    }

    // 4. Índice de expiración de la blacklist
    if (await indexExists('token_blacklist', 'idx_blacklist_expires')) {
        console.log('[4] idx_blacklist_expires ya existe');
    } else {
        await db.query('CREATE INDEX idx_blacklist_expires ON token_blacklist (expires_at)');
        console.log('[4] idx_blacklist_expires creado');
    }

    // 4b. Índice para el feed por cursor (WHERE is_log_public = 1 AND id < ? ORDER BY id DESC)
    if (await indexExists('reading_logs', 'idx_logs_public_id')) {
        console.log('[4b] idx_logs_public_id ya existe');
    } else {
        await db.query('CREATE INDEX idx_logs_public_id ON reading_logs (is_log_public, id)');
        console.log('[4b] idx_logs_public_id creado');
    }

    // 5. Usernames fuera del nuevo formato
    const [badUsernames] = await db.query(
        "SELECT id, username FROM users WHERE username NOT REGEXP '^[a-zA-Z0-9_.-]{3,30}$'"
    );
    if (badUsernames.length > 0) {
        console.warn('[5] Usernames que no cumplen el formato nuevo (no podrán abrirse vía /users/:username):');
        console.table(badUsernames);
    } else {
        console.log('[5] Todos los usernames cumplen el formato');
    }
}

migrate()
    .catch((error) => {
        console.error('Error en la migración:', error);
        process.exitCode = 1;
    })
    .finally(() => db.end());
