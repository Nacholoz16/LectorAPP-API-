const pool = require('./src/config/db');

async function createTable() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS token_blacklist (
                token VARCHAR(500) PRIMARY KEY,
                expires_at DATETIME NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('Tabla token_blacklist creada con éxito.');
        process.exit(0);
    } catch (err) {
        console.error('Error al crear tabla:', err);
        process.exit(1);
    }
}

createTable();
