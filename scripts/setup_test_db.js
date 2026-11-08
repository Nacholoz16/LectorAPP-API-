const db = require('../src/config/db');

async function setupTestDb() {
  if (process.env.NODE_ENV !== 'test') {
    console.error('Este script solo debe ejecutarse con NODE_ENV=test (usa la BD anti_social_test).');
    process.exit(1);
  }
  console.log('Creando/verificando tablas en DB de test...');

  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(50) NOT NULL UNIQUE,
      email VARCHAR(100) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      bio VARCHAR(500),
      avatar_url VARCHAR(255),
      is_profile_public TINYINT(1) DEFAULT 1,
      are_stats_public TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  try { await db.query('ALTER TABLE users ADD COLUMN are_stats_public TINYINT(1) NOT NULL DEFAULT 1'); } catch (_) {}
  try { await db.query('ALTER TABLE users ADD COLUMN password_changed_at BIGINT UNSIGNED NULL'); } catch (_) {}

  await db.query(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      code_hash CHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
      used_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_resets_user (user_id, used_at),
      CONSTRAINT fk_resets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
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
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS token_blacklist (
      token VARCHAR(500) PRIMARY KEY,
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_blacklist_expires (expires_at)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS books (
      id INT AUTO_INCREMENT PRIMARY KEY,
      external_id VARCHAR(255) NOT NULL UNIQUE,
      isbn VARCHAR(50),
      title VARCHAR(255) NOT NULL,
      author VARCHAR(255),
      cover_url VARCHAR(500),
      page_count INT,
      published_year INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  try { await db.query('ALTER TABLE books ADD COLUMN published_year INT NULL'); } catch (_) {}

  await db.query(`
    CREATE TABLE IF NOT EXISTS reading_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      book_id INT NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'leyendo',
      rating INT,
      review_text TEXT,
      start_date DATE,
      finish_date DATE,
      duration_days INT DEFAULT 0,
      is_log_public TINYINT(1) DEFAULT 0,
      current_page INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  try { await db.query('ALTER TABLE reading_logs ADD COLUMN current_page INT DEFAULT 0'); } catch (_) {}
  try { await db.query('ALTER TABLE reading_logs ADD UNIQUE KEY uniq_user_book (user_id, book_id)'); } catch (_) {}
  try { await db.query('CREATE INDEX idx_logs_public_id ON reading_logs (is_log_public, id)'); } catch (_) {}

  await db.query(`
    CREATE TABLE IF NOT EXISTS reading_likes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      reading_log_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_user_log (user_id, reading_log_id)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS reading_sessions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      reading_log_id INT NOT NULL,
      duration_minutes INT NOT NULL DEFAULT 0,
      pages_read INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS reading_goals (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      year INT NOT NULL,
      target_books INT NOT NULL DEFAULT 10,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_user_year (user_id, year)
    )
  `);

  console.log('Tablas de test listas.');
  process.exit(0);
}

setupTestDb().catch(e => { console.error(e); process.exit(1); });
