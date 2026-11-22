const UserModel = require('../../models/user.model');
const db = require('../../config/db');
const { verifyToken, hashToken, extractBearerToken } = require('../../utils/tokens');
const { AccountDeactivatedError, UnauthorizedError } = require('../../utils/errors');

/**
 * Autentica: exige un JWT válido, no revocado y de un usuario existente, SIN mirar el estado
 * de la cuenta. Deja disponibles `req.user` (incluye `status`) y `req.token`.
 *
 * Úsalo directamente solo en las rutas que una cuenta desactivada SÍ puede usar (ver su
 * biblioteca, las estadísticas de sus libros, el estado de la cuenta, reactivar). Todo lo demás
 * va con `protect`, que además exige cuenta activa.
 *
 * Nota: los errores de base de datos se propagan como 500 (no como 401),
 * para que una caída momentánea de MySQL no cierre la sesión de todos los usuarios.
 */
const authenticate = async (req, res, next) => {
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

        // 4. ¿Se cambió la contraseña después de emitir este token? (recuperación de cuenta:
        //    cierra las sesiones abiertas en otros dispositivos). iat está en segundos.
        if (user.password_changed_at) {
            const changedAt = Number(user.password_changed_at);
            if (decoded.iat < changedAt) {
                return next(new UnauthorizedError('La contraseña cambió. Inicia sesión de nuevo.'));
            }
        }
        delete user.password_changed_at;

        req.user = user;
        req.token = token;
        next();
    } catch (error) {
        next(error);
    }
};

/**
 * Exige que la cuenta esté activa (va después de `authenticate`). Una cuenta desactivada por su
 * dueño (D7) responde 403 ACCOUNT_DEACTIVATED: el cliente pasa a modo solo lectura.
 *
 * El estado se lee de la BD en cada petición (lo trae `authenticate`), no del JWT: desactivar o
 * reactivar tiene efecto en la petición siguiente, sin esperar a que venza el token de acceso.
 * Las cuentas suspendidas (D5, Épica 4) tendrán su propio tratamiento; aquí solo se deja pasar
 * 'active' para que ningún estado nuevo quede abierto por omisión.
 */
const requireActive = (req, res, next) => {
    if (!req.user) return next(new UnauthorizedError('No autorizado, falta token'));
    if (req.user.status !== 'active') return next(new AccountDeactivatedError());
    next();
};

/**
 * `authenticate` + `requireActive`. Es el middleware por defecto de toda ruta con sesión: así
 * cualquier endpoint nuevo queda cerrado a las cuentas desactivadas salvo que se excluya a
 * propósito (montándolo con `authenticate` antes del `router.use(protect)`).
 */
const protect = (req, res, next) => {
    authenticate(req, res, (err) => (err ? next(err) : requireActive(req, res, next)));
};

module.exports = { authenticate, requireActive, protect };
