const express = require('express');
const router = express.Router();
const UserController = require('../controllers/user.controller');
const { protect } = require('../middlewares/auth.middleware');

// GET /api/users/:username (Protegido para saber quién visita)
router.get('/:username', protect, UserController.getProfile);

module.exports = router;