const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

// Inicializar app
const app = express();

// Middlewares Globales
app.use(helmet()); // Seguridad HTTP headers
app.use(cors()); // Permitir peticiones desde Ionic/Angular
app.use(express.json()); // Parsear body JSON
app.use(morgan('dev')); // Logger de peticiones en consola



// Rutas AUTH
const authRoutes = require('./api/routes/auth.routes');
//console.log("authRoutes:", authRoutes);
app.use('/api/auth', authRoutes);

// Rutas BOOKS
const bookRoutes = require('./api/routes/book.routes');
//console.log("bookRoutes:", bookRoutes);
app.use('/api/books', bookRoutes);

// Rutas READINGS
const readingRoutes = require('./api/routes/reading.routes');
//console.log("readingRoutes:", readingRoutes);
app.use('/api/readings', readingRoutes);

// Rutas USERS
const userRoutes = require('./api/routes/user.routes');
//console.log("userRoutes:", userRoutes);
app.use('/api/users', userRoutes);


//===================================================================================

app.get('/api/health', async (req, res) => {
    try {
        // Probamos conexión a DB
        const db = require('./config/db');
        const [rows] = await db.query('SELECT 1 as val');
        res.json({ 
            status: 'OK', 
            server: 'Running', 
            db: rows[0].val === 1 ? 'Connected' : 'Error' 
        });
        console.log('Health check passed');
    } catch (error) {
        res.status(500).json({ status: 'ERROR', error: error.message });
    }
});

// Middleware de Manejo de Errores Global
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ 
        error: 'Algo salió mal en el servidor',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Iniciar Servidor
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Server corriendo en http://localhost:${PORT}`);
    });
}

module.exports = app;