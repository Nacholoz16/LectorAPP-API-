const express = require('express');
const rateLimit = require('express-rate-limit');
const AccountController = require('../controllers/account.controller');
const { authenticate, protect } = require('../middlewares/auth.middleware');
const { validate } = require('../middlewares/validate');
const { passwordConfirmSchema } = require('../validators/account.validators');

const router = express.Router();
const isTest = process.env.NODE_ENV === 'test';

// Confirmar con la contraseña desde una sesión abierta: quien robe un token de acceso no debe
// poder probar contraseñas sin límite. Por cuenta (hay `req.user`) y solo intentos fallidos.
const passwordConfirmLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => `account-password:${req.user.id}`,
    skip: () => isTest,
    message: {
        error: 'Demasiados intentos con una contraseña incorrecta. Espera 15 minutos.',
        code: 'RATE_LIMITED',
    },
});

// --- Rutas que una cuenta DESACTIVADA también puede usar (D7) ---
// Van con `authenticate` (no exige cuenta activa) y ANTES del `router.use(protect)`.
// La 2.2 sumará aquí DELETE /account (eliminar la cuenta también debe poder hacerse desactivada).

// GET /api/account/status — estado de la cuenta y conteos para los textos de confirmación.
router.get('/status', authenticate, AccountController.getStatus);
// POST /api/account/deactivate — con contraseña. Una cuenta ya desactivada recibe 409.
router.post(
    '/deactivate',
    authenticate,
    passwordConfirmLimiter,
    validate({ body: passwordConfirmSchema }),
    AccountController.deactivate
);
// POST /api/account/reactivate — sin contraseña (la sesión ya está autenticada). Activa → 409.
router.post('/reactivate', authenticate, AccountController.reactivate);

// --- Resto: solo cuentas activas ---
router.use(protect);

// POST /api/account/terms — acepta la versión vigente de los Términos y la Política de
// privacidad (tarea 1.3). No lleva body: solo se puede aceptar la versión publicada.
router.post('/terms', AccountController.acceptTerms);

module.exports = router;
