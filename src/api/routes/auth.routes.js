const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const AuthController = require('../controllers/auth.controller');

// Limitador de intentos para prevenir fuerza bruta
const authLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutos
    max: 10, // 10 peticiones por IP cada 5 min
    message: { error: 'Demasiados intentos de inicio de sesión, por favor intenta de nuevo en 5 minutos.' }
});

// Definir endpoints
router.post('/register', authLimiter, AuthController.register);
router.post('/login', authLimiter, AuthController.login);
router.post('/logout', AuthController.logout);

module.exports = router;