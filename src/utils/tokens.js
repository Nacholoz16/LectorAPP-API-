const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_ALGORITHM = 'HS256';
const JWT_EXPIRES_IN = '7d';

const signToken = (userId) =>
    jwt.sign({ id: userId }, process.env.JWT_SECRET, {
        algorithm: JWT_ALGORITHM,
        expiresIn: JWT_EXPIRES_IN,
    });

/** Verifica firma y expiración. Fija el algoritmo para evitar ataques de confusión de algoritmo. */
const verifyToken = (token) =>
    jwt.verify(token, process.env.JWT_SECRET, { algorithms: [JWT_ALGORITHM] });

/**
 * La blacklist guarda el SHA-256 del token, nunca el token en claro:
 * si la tabla se filtra, los tokens aún vigentes no son reutilizables.
 */
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

/** Extrae el token de "Authorization: Bearer <token>". */
const extractBearerToken = (req) => {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return null;
    const token = header.slice(7).trim();
    return token || null;
};

module.exports = { signToken, verifyToken, hashToken, extractBearerToken };
