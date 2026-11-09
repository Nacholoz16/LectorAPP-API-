const express = require('express');
const { protect } = require('../middlewares/auth.middleware');
const { requireAdmin, createAdminLimiter } = require('../middlewares/admin.middleware');

const router = express.Router();
const isTest = process.env.NODE_ENV === 'test';

// Se aplican a nivel de router: CUALQUIER ruta bajo /api/admin (exista o no) responde 401 sin
// token y 403 a un usuario normal antes que un 404, para no revelar qué endpoints existen.
// Para un admin, una ruta inexistente cae en el 404 global de app.js.
router.use(protect, createAdminLimiter({ skip: () => isTest }), requireAdmin);

// Los endpoints de moderación (tareas 4.2–4.4 y 5.3) se montan aquí. Ninguno puede cambiar
// `users.role`: el rol solo se asigna por SQL / scripts/grant_admin.js (decisión D3).

module.exports = router;
