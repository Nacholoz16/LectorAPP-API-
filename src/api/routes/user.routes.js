const express = require('express');
const UserController = require('../controllers/user.controller');
const { protect } = require('../middlewares/auth.middleware');
const { validate } = require('../middlewares/validate');
const { paginationQuery, usernameParam } = require('../validators/common');
const { goalSchema, privacySchema } = require('../validators/user.validators');

const router = express.Router();

router.use(protect);

// POST /api/users/goal (Fijar meta de lectura)
router.post('/goal', validate({ body: goalSchema }), UserController.setGoal);

// PUT /api/users/privacy (Actualizar ajustes de privacidad)
router.put('/privacy', validate({ body: privacySchema }), UserController.updatePrivacy);

// Las rutas con sufijo deben ir ANTES de /:username
router.get('/:username/library', validate({ params: usernameParam, query: paginationQuery }), UserController.getLibrary);
router.get('/:username/stats', validate({ params: usernameParam }), UserController.getStats);
router.get('/:username', validate({ params: usernameParam }), UserController.getProfile);

module.exports = router;
