const AuthService = require('../../services/auth.service');

// Los bodies ya llegan validados y normalizados por el middleware `validate` (ver auth.routes.js).
// Express 5 propaga automáticamente los errores de funciones async al manejador global.

const register = async (req, res) => {
    const result = await AuthService.registerUser(req.body);
    res.status(201).json({ message: 'Usuario registrado exitosamente', ...result });
};

const login = async (req, res) => {
    const result = await AuthService.loginUser(req.body);
    res.json({ message: 'Login exitoso', ...result });
};

const logout = async (req, res) => {
    await AuthService.logout(req.token);
    res.json({ message: 'Logout exitoso', success: true });
};

module.exports = { register, login, logout };
