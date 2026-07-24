const pool = require('./src/config/db');

async function alterTable() {
    try {
        await pool.query(`
            ALTER TABLE reading_logs 
            ADD COLUMN current_page INT DEFAULT 0
        `);
        console.log('Columna current_page añadida a reading_logs con éxito.');
        process.exit(0);
    } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
            console.log('La columna current_page ya existe en reading_logs.');
            process.exit(0);
        }
        console.error('Error al alterar tabla reading_logs:', err);
        process.exit(1);
    }
}

alterTable();
