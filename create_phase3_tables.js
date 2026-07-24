const pool = require('./src/config/db');

async function createTables() {
    try {
        // Tabla de sesiones de lectura con cronómetro/minutos
        await pool.query(`
            CREATE TABLE IF NOT EXISTS reading_sessions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                reading_log_id INT NOT NULL,
                duration_minutes INT NOT NULL DEFAULT 0,
                pages_read INT NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (reading_log_id) REFERENCES reading_logs(id) ON DELETE CASCADE
            )
        `);
        console.log('Tabla reading_sessions creada con éxito.');

        // Tabla de metas de lectura anuales
        await pool.query(`
            CREATE TABLE IF NOT EXISTS reading_goals (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                year INT NOT NULL,
                target_books INT NOT NULL DEFAULT 10,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_user_year (user_id, year),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        console.log('Tabla reading_goals creada con éxito.');

        process.exit(0);
    } catch (err) {
        console.error('Error al crear tablas de la fase 3:', err);
        process.exit(1);
    }
}

createTables();
