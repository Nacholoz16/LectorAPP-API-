const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_ALGORITHM = 'HS256';
// Token de acceso corto: si se filtra, sirve poco tiempo. La sesión larga la da el refresh token.
const JWT_EXPIRES_IN = '30m';
const REFRESH_TOKEN_TTL_DAYS = 60;

/**
 * `jwtid` (jti) aleatorio: sin él, dos tokens del mismo usuario emitidos en el mismo segundo
 * serían idénticos, y revocar uno (logout, blacklist por hash) revocaría también el otro.
 */
const signToken = (userId) =>
    jwt.sign({ id: userId }, process.env.JWT_SECRET, {
        algorithm: JWT_ALGORITHM,
        expiresIn: JWT_EXPIRES_IN,
        jwtid: crypto.randomUUID(),
    });

/** Verifica firma y expiración. Fija el algoritmo para evitar ataques de confusión de algoritmo. */
const verifyToken = (token) =>
    jwt.verify(token, process.env.JWT_SECRET, { algorithms: [JWT_ALGORITHM] });

/**
 * La blacklist guarda el SHA-256 del token, nunca el token en claro:
 * si la tabla se filtra, los tokens aún vigentes no son reutilizables.
 */
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

/** Refresh token opaco (no es JWT): 256 bits aleatorios. En BD solo se guarda su SHA-256. */
const generateRefreshToken = () => crypto.randomBytes(32).toString('base64url');

/** Extrae el token de "Authorization: Bearer <token>". */
const extractBearerToken = (req) => {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return null;
    const token = header.slice(7).trim();
    return token || null;
};

module.exports = {
    signToken,
    verifyToken,
    hashToken,
    extractBearerToken,
    generateRefreshToken,
    REFRESH_TOKEN_TTL_DAYS,
};
