const { validateEnv } = require('./config/env');
validateEnv();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const pinoHttp = require('pino-http');
const rateLimit = require('express-rate-limit');
const logger = require('./utils/logger');
const db = require('./config/db');
const { AppError } = require('./utils/errors');

const isTest = process.env.NODE_ENV === 'test';

const app = express();

// La API corre detrás de Nginx: confiar en el primer proxy para obtener la IP real
// del cliente (req.ip). Sin esto, el rate limiting agrupa a todos bajo la IP del proxy.
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));

// --- Middlewares globales ---
app.use(helmet());
app.use(cors({
    origin: [
        'https://nacholoz3d.cl',
        'https://www.nacholoz3d.cl',
        'http://localhost:3000',
        'http://localhost:4200',
    ],
    credentials: true,
}));
// gzip de respuestas JSON (el feed y las bibliotecas se reducen ~70-80%). Si Nginx ya
// comprime, no hay doble compresión: Nginx no recomprime respuestas con Content-Encoding.
app.use(compression());
app.use(express.json({ limit: '100kb' }));

// Log de peticiones estructurado. Solo método, URL, status y tiempo: nunca bodies ni headers.
app.use(pinoHttp({
    logger,
    // El healthcheck de Docker llama a /api/health cada 30 s: no llenar el log con eso.
    autoLogging: { ignore: (req) => req.url === '/api/health' },
    serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
    },
    customLogLevel: (req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
    },
}));

// Límite general por IP para toda la API (los endpoints sensibles tienen límites propios más estrictos).
app.use('/api', rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => isTest,
    message: { error: 'Demasiadas peticiones, intenta de nuevo más tarde.', code: 'RATE_LIMITED' },
}));

// --- Rutas ---
app.use('/api/auth', require('./api/routes/auth.routes'));
app.use('/api/books', require('./api/routes/book.routes'));
app.use('/api/readings', require('./api/routes/reading.routes'));
app.use('/api/users', require('./api/routes/user.routes'));

app.get('/api/health', async (req, res) => {
    try {
        await db.query('SELECT 1');
        res.json({ status: 'OK', db: 'Connected' });
    } catch (err) {
        req.log.error({ err }, 'Health check: base de datos no disponible');
        res.status(503).json({ status: 'ERROR', db: 'Disconnected' });
    }
});

// --- 404 ---
app.use((req, res) => {
    res.status(404).json({ error: 'Ruta no encontrada', code: 'NOT_FOUND' });
});

// --- Manejo de errores global ---
// Formato único de error para toda la API: { error: string, code: string }
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'JSON inválido', code: 'INVALID_JSON' });
    }
    if (err.type === 'entity.too.large') {
        return res.status(413).json({ error: 'La petición es demasiado grande', code: 'PAYLOAD_TOO_LARGE' });
    }
    if (err instanceof AppError) {
        return res.status(err.status).json({ error: err.message, code: err.code });
    }

    req.log.error({ err }, 'Error no controlado');
    res.status(500).json({ error: 'Algo salió mal en el servidor', code: 'INTERNAL_ERROR' });
});

// --- Arranque ---
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        logger.info(`Servidor corriendo en http://localhost:${PORT}`);
    });
}

module.exports = app;
