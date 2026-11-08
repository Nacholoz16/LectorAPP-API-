const express = require('express');
const rateLimit = require('express-rate-limit');
const AuthController = require('../controllers/auth.controller');
const { protect } = require('../middlewares/auth.middleware');
const { validate } = require('../middlewares/validate');
const {
    registerSchema,
    loginSchema,
    forgotPasswordSchema,
    resetPasswordSchema,
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

router.post('/register', registerLimiter, validate({ body: registerSchema }), AuthController.register);
router.post('/login', loginLimiter, validate({ body: loginSchema }), AuthController.login);
// Solo se puede revocar un token válido (evita que cualquiera llene la blacklist con basura).
router.post('/logout', protect, AuthController.logout);
router.post('/forgot-password', forgotLimiter, validate({ body: forgotPasswordSchema }), AuthController.forgotPassword);
router.post('/reset-password', resetLimiter, validate({ body: resetPasswordSchema }), AuthController.resetPassword);

module.exports = router;
