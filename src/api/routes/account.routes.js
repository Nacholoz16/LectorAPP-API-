const express = require('express');
const AccountController = require('../controllers/account.controller');
const { protect } = require('../middlewares/auth.middleware');

const router = express.Router();

router.use(protect);

// POST /api/account/terms — acepta la versión vigente de los Términos y la Política de
// privacidad (tarea 1.3). No lleva body: solo se puede aceptar la versión publicada.
// Aquí se montarán también desactivar/reactivar y eliminar la cuenta (tareas 2.1 y 2.2).
router.post('/terms', AccountController.acceptTerms);

module.exports = router;
