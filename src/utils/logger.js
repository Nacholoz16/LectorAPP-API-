const pino = require('pino');

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

/**
 * Logger estructurado.
 * - Nunca registra cuerpos de petición (contienen contraseñas, reseñas, etc.).
 * - Redacta credenciales por si algún log futuro incluye headers o bodies.
 */
const logger = pino({
    level: process.env.LOG_LEVEL || (isTest ? 'silent' : isProd ? 'info' : 'debug'),
    redact: {
        paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
            '*.password',
            '*.token',
            '*.password_hash',
        ],
        censor: '[REDACTED]',
    },
});

module.exports = logger;
