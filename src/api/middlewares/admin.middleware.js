const rateLimit = require('express-rate-limit');
const db = require('../../config/db');
const { ForbiddenError, UnauthorizedError } = require('../../utils/errors');

/**
 * Exige que el usuario autenticado tenga `users.role = 'admin'`. Va SIEMPRE después de `protect`.
 *
 * El rol se lee de la BD en cada petición (no de un claim del JWT): así, quitarle el rol a una
 * cuenta tiene efecto en la petición siguiente, sin esperar a que venza su token de acceso.
 */
const requireAdmin = async (req, res, next) => {
    if (!req.user) {
        // Error de montaje (falta `protect` antes): nunca dejar pasar.
        return next(new UnauthorizedError('No autorizado, falta token'));
    }
    try {
        const [rows] = await db.execute('SELECT role FROM users WHERE id = ? LIMIT 1', [req.user.id]);
        if (rows[0]?.role !== 'admin') {
            return next(new ForbiddenError('No tienes permiso para acceder a la administración'));
        }
        next();
    } catch (error) {
        next(error);
    }
};

/**
 * Límite propio de `/admin/*`, por cuenta (va después de `protect`, así que hay `req.user`).
 * Cuenta también a los usuarios normales que insisten en entrar: reciben 429 antes que 403.
 * Es una fábrica para poder probarlo con límites pequeños.
 */
const createAdminLimiter = ({ windowMs = 15 * 60 * 1000, limit = 100, skip } = {}) =>
    rateLimit({
        windowMs,
        limit,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        keyGenerator: (req) => `admin-user:${req.user.id}`,
        ...(skip ? { skip } : {}),
        message: {
            error: 'Demasiadas peticiones a la administración. Espera unos minutos.',
            code: 'RATE_LIMITED',
        },
    });

module.exports = { requireAdmin, createAdminLimiter };
