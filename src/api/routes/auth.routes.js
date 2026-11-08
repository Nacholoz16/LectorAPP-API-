const express = require('express');
const rateLimit = require('express-rate-limit');
const AuthController = require('../controllers/auth.controller');
const { validate } = require('../middlewares/validate');
const {
    registerSchema,
    loginSchema,
    forgotPasswordSchema,
    resetPasswordSchema,
    refreshSchema,
    logoutSchema,
} = require('../validators/auth.validators');

const router = express.Router();
const isTest = process.env.NODE_ENV === 'test';

// Fuerza bruta: solo cuentan los intentos fallidos.
const loginLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 10,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => isTest,
    message: {
        error: 'Demasiados intentos de inicio de sesión, por favor intenta de nuevo en 5 minutos.',
        code: 'RATE_LIMITED',
    },
});

// Creación masiva de cuentas.
const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => isTest,
    message: {
        error: 'Demasiados registros desde esta red, intenta de nuevo más tarde.',
        code: 'RATE_LIMITED',
    },
});

// Pedir códigos de recuperación: pocas veces por red (además del enfriamiento de 60 s por cuenta).
const forgotLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => isTest,
    message: {
        error: 'Demasiadas solicitudes de recuperación. Intenta de nuevo en una hora.',
        code: 'RATE_LIMITED',
    },
});

// Probar códigos: además del límite de 5 intentos por código.
const resetLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => isTest,
    message: {
        error: 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.',
        code: 'RATE_LIMITED',
    },
});

// Renovación de sesión: la app la hace sola cada ~30 min; el límite solo frena abusos.
const refreshLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => isTest,
    message: { error: 'Demasiadas renovaciones de sesión. Espera un momento.', code: 'RATE_LIMITED' },
});

router.post('/register', registerLimiter, validate({ body: registerSchema }), AuthController.register);
router.post('/login', loginLimiter, validate({ body: loginSchema }), AuthController.login);
// Revoca el token de acceso (si aún es válido) y/o la familia del refresh token. Exige al menos
// uno válido: así nadie puede llenar la blacklist con basura.
router.post('/logout', validate({ body: logoutSchema }), AuthController.logout);
router.post('/refresh', refreshLimiter, validate({ body: refreshSchema }), AuthController.refresh);
router.post('/forgot-password', forgotLimiter, validate({ body: forgotPasswordSchema }), AuthController.forgotPassword);
router.post('/reset-password', resetLimiter, validate({ body: resetPasswordSchema }), AuthController.resetPassword);

module.exports = router;
