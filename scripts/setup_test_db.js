const db = require('../src/config/db');

async function setupTestDb() {
  console.log('Creando/verificando tablas en DB de test...');

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
