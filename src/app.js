const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

// Inicializar app
const app = express();

// Middlewares Globales
app.use(helmet()); // Seguridad HTTP headers
app.use(cors({
  origin: [
    'https://nacholoz3d.cl',
    'https://www.nacholoz3d.cl',
    'http://localhost:3000',
    'http://localhost:4200',
  ],
  credentials: true,
})); // Permitir solo orígenes conocidos
app.use(express.json({ limit: '1mb' })); // Parsear body JSON con límite de tamaño
app.use(morgan('dev')); // Logger de peticiones en consola

// Logger detallado personalizado
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`\n[API REQUEST ${timestamp}] ${req.method} ${req.originalUrl}`);
    if (Object.keys(req.query).length > 0) {
        console.log(`  Query:`, JSON.stringify(req.query));
    }
    if (req.body && Object.keys(req.body).length > 0) {
        console.log(`  Body:`, JSON.stringify(req.body));
    }

    const oldSend = res.send;
    res.send = function (data) {
        console.log(`[API RESPONSE ${timestamp}] Status: ${res.statusCode}`);
        return oldSend.apply(res, arguments);
    };
    next();
});



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