const pool = require('./src/config/db');

async function createTable() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS reading_likes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                reading_log_id INT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_user_reading_like (user_id, reading_log_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (reading_log_id) REFERENCES reading_logs(id) ON DELETE CASCADE
            )
        `);
        console.log('Tabla reading_likes creada con éxito.');
        process.exit(0);
    } catch (err) {
        console.error('Error al crear tabla reading_likes:', err);
        process.exit(1);
    }
}

createTable();
