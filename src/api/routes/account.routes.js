const express = require('express');
const rateLimit = require('express-rate-limit');
const AccountController = require('../controllers/account.controller');
const { authenticate, protect } = require('../middlewares/auth.middleware');
const { validate } = require('../middlewares/validate');
const {
    passwordConfirmSchema,
    deletionRequestSchema,
    deletionConfirmSchema,
} = require('../validators/account.validators');

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

// --- Eliminar la cuenta desde la web, SIN sesión (tarea 2.3) ---
// Mismos límites por IP que forgot/reset (además del enfriamiento de 60 s por cuenta y de los 5
// intentos por código que aplica el servicio).
const deletionRequestLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => isTest,
    message: {
        error: 'Demasiadas solicitudes. Intenta de nuevo en una hora.',
        code: 'RATE_LIMITED',
    },
});
const deletionConfirmLimiter = rateLimit({
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

// POST /api/account/deletion-request { email } → siempre 200 { message } idéntico.
router.post(
    '/deletion-request',
    deletionRequestLimiter,
    validate({ body: deletionRequestSchema }),
    AccountController.requestDeletion
);
// POST /api/account/deletion-confirm { email, code } → 200 { deleted: true } | 400 genérico.
router.post(
    '/deletion-confirm',
    deletionConfirmLimiter,
    validate({ body: deletionConfirmSchema }),
    AccountController.confirmDeletion
);

// --- Rutas que una cuenta DESACTIVADA también puede usar (D7) ---
// Van con `authenticate` (no exige cuenta activa) y ANTES del `router.use(protect)`.

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
// DELETE /api/account — elimina la cuenta y sus datos para siempre (tarea 2.2), con contraseña.
// Comparte el límite de intentos con /deactivate (misma instancia → mismo contador por cuenta):
// alternar entre ambas rutas no da más intentos.
router.delete(
    '/',
    authenticate,
    passwordConfirmLimiter,
    validate({ body: passwordConfirmSchema }),
    AccountController.deleteAccount
);

// --- Resto: solo cuentas activas ---
router.use(protect);

// POST /api/account/terms — acepta la versión vigente de los Términos y la Política de
// privacidad (tarea 1.3). No lleva body: solo se puede aceptar la versión publicada.
router.post('/terms', AccountController.acceptTerms);

module.exports = router;
