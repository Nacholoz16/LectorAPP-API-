const express = require('express');
const router = express.Router();
const UserController = require('../controllers/user.controller');
const { protect } = require('../middlewares/auth.middleware');

// POST /api/users/goal (Fijar meta de lectura)
router.post('/goal', protect, UserController.setGoal);

// PUT /api/users/privacy (Actualizar ajustes de privacidad)
router.put('/privacy', protect, UserController.updatePrivacy);

// GET /api/users/:username/library (Biblioteca paginada) - Debe ir ANTES de /:username
router.get('/:username/library', protect, UserController.getLibrary);

// GET /api/users/:username/stats (Estadísticas del usuario)
router.get('/:username/stats', protect, UserController.getStats);

// GET /api/users/:username (Protegido para saber quién visita)
router.get('/:username', protect, UserController.getProfile);

module.exports = router;