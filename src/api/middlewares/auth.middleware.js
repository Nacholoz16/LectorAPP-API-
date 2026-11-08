const UserModel = require('../../models/user.model');
const db = require('../../config/db');
const { verifyToken, hashToken, extractBearerToken } = require('../../utils/tokens');
const { UnauthorizedError } = require('../../utils/errors');

/**
 * Exige un JWT válido, no revocado y de un usuario existente.
 * Deja disponibles `req.user` y `req.token`.
 *
 * Nota: los errores de base de datos se propagan como 500 (no como 401),
 * para que una caída momentánea de MySQL no cierre la sesión de todos los usuarios.
 */
const protect = async (req, res, next) => {
    const token = extractBearerToken(req);
    if (!token) {
        return next(new UnauthorizedError('No autorizado, falta token'));
    }

    // 1. Verificación criptográfica primero: es barata y descarta basura sin tocar la BD.
    let decoded;
    try {
        decoded = verifyToken(token);
    } catch {
        return next(new UnauthorizedError('Token no autorizado o expirado'));
    }

    try {
        // 2. ¿Fue revocado con logout?
        const [revoked] = await db.execute(
            'SELECT 1 FROM token_blacklist WHERE token = ? LIMIT 1',
            [hashToken(token)]
        );
        if (revoked.length > 0) {
            return next(new UnauthorizedError('Token revocado'));
        }

        // 3. ¿El usuario sigue existiendo?
        const user = await UserModel.findById(decoded.id);
        if (!user) {
            return next(new UnauthorizedError('Usuario no encontrado con este token'));
        }

        req.user = user;
        req.token = token;
        next();
    } catch (error) {
        next(error);
    }
};

module.exports = { protect };
