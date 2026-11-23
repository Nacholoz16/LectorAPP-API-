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
 * 6. Recuperación de contraseña: tabla password_resets y users.password_changed_at
 *    (segundos Unix; los JWT emitidos antes de ese momento dejan de valer).
 * 7. Refresh tokens (sesiones largas rotativas): tabla refresh_tokens.
 * 8. Administración (tarea 4.1): users.role ('user' | 'admin'; se asigna solo por SQL o con
 *    scripts/grant_admin.js) y tabla admin_actions (auditoría de cada acción de admin).
 * 9. Aceptación de términos (tarea 1.3): users.terms_version y users.terms_accepted_at.
 *    Quedan en NULL para las cuentas existentes (deberán aceptar antes de publicar); sus
 *    lecturas públicas actuales NO se modifican.
 * 10. Desactivar / reactivar la cuenta (tarea 2.1, D7): users.status ('active' | 'deactivated' |
 *    'suspended'; todas las cuentas existentes quedan 'active'), users.status_changed_at,
 *    reading_logs.public_before_deactivation (visibilidad a restaurar al reactivar) y
 *    reading_logs.moderation_locked_at (privada permanente por moderación, D4; la usará la 3.1,
 *    pero la reactivación ya la respeta).
 * 11. Eliminar la cuenta desde la web (tarea 2.3): tabla deletion_requests (códigos de 6 dígitos
 *    guardados como HMAC, por user_id; se borran junto con la cuenta).
 */
require('dotenv').config({ quiet: true });
const db = require('../src/config/db');

const columnExists = async (table, column) => {
    const [rows] = await db.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1`,
        [table, column]
    );
    return rows.length > 0;
};

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

    // 6. Recuperación de contraseña
    await db.query(`CREATE TABLE IF NOT EXISTS password_resets (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      code_hash CHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
      used_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_resets_user (user_id, used_at),
      CONSTRAINT fk_resets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    console.log('[6] Tabla password_resets lista');
    if (await columnExists('users', 'password_changed_at')) {
        console.log('[6] users.password_changed_at ya existe');
    } else {
        await db.query('ALTER TABLE users ADD COLUMN password_changed_at BIGINT UNSIGNED NULL');
        console.log('[6] users.password_changed_at creada');
    }

    // 7. Refresh tokens
    await db.query(`CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      token_hash CHAR(64) NOT NULL UNIQUE,
      family_id CHAR(36) NOT NULL,
      expires_at DATETIME NOT NULL,
      revoked_at DATETIME NULL,
      replaced_by_id INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_refresh_user (user_id),
      INDEX idx_refresh_family (family_id),
      INDEX idx_refresh_expires (expires_at),
      CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    console.log('[7] Tabla refresh_tokens lista');

    // 8. Rol de administrador y auditoría
    if (await columnExists('users', 'role')) {
        console.log('[8] users.role ya existe');
    } else {
        await db.query("ALTER TABLE users ADD COLUMN role ENUM('user','admin') NOT NULL DEFAULT 'user'");
        console.log('[8] users.role creada');
    }
    // admin_id con SET NULL (no CASCADE): si se borra la cuenta del admin, el historial se conserva.
    // target_id no tiene FK porque apunta a distintas tablas según target_type.
    await db.query(`CREATE TABLE IF NOT EXISTS admin_actions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      admin_id INT NULL,
      action VARCHAR(50) NOT NULL,
      target_type VARCHAR(30) NOT NULL,
      target_id INT NULL,
      note VARCHAR(500) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_admin_actions_created (created_at),
      INDEX idx_admin_actions_target (target_type, target_id),
      CONSTRAINT fk_admin_actions_admin FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL
    )`);
    console.log('[8] Tabla admin_actions lista');

    // 9. Aceptación de términos
    if (await columnExists('users', 'terms_version')) {
        console.log('[9] users.terms_version ya existe');
    } else {
        await db.query('ALTER TABLE users ADD COLUMN terms_version VARCHAR(20) NULL');
        console.log('[9] users.terms_version creada');
    }
    if (await columnExists('users', 'terms_accepted_at')) {
        console.log('[9] users.terms_accepted_at ya existe');
    } else {
        await db.query('ALTER TABLE users ADD COLUMN terms_accepted_at DATETIME NULL');
        console.log('[9] users.terms_accepted_at creada');
    }

    // 10. Estado de la cuenta y visibilidad a restaurar.
    // status_changed_at es DATETIME (como terms_accepted_at): es un dato para personas y para el
    // panel de administración, no se compara con el `iat` del JWT como password_changed_at.
    // Sin índice en users.status: siempre se filtra junto a un JOIN por id (PK).
    const step10Columns = [
        ['users', 'status', "ENUM('active','deactivated','suspended') NOT NULL DEFAULT 'active'"],
        ['users', 'status_changed_at', 'DATETIME NULL'],
        ['reading_logs', 'public_before_deactivation', 'TINYINT(1) NULL'],
        ['reading_logs', 'moderation_locked_at', 'DATETIME NULL'],
    ];
    for (const [table, column, definition] of step10Columns) {
        if (await columnExists(table, column)) {
            console.log(`[10] ${table}.${column} ya existe`);
        } else {
            await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
            console.log(`[10] ${table}.${column} creada`);
        }
    }

    // 11. Solicitudes de eliminación desde la web. Mismo esquema que password_resets: por user_id
    // (no por hash del email) para que el borrado de la cuenta se lleve también estas filas.
    await db.query(`CREATE TABLE IF NOT EXISTS deletion_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      code_hash CHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
      used_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_deletion_user (user_id, used_at),
      CONSTRAINT fk_deletion_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    console.log('[11] Tabla deletion_requests lista');
}

migrate()
    .catch((error) => {
        console.error('Error en la migración:', error);
        process.exitCode = 1;
    })
    .finally(() => db.end());
