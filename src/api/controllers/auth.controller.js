const AuthService = require('../../services/auth.service');
const { extractBearerToken } = require('../../utils/tokens');

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
    await AuthService.logout({
        accessToken: extractBearerToken(req),
        refreshToken: req.body.refresh_token,
    });
    res.json({ message: 'Logout exitoso', success: true });
};

const refresh = async (req, res) => {
    const session = await AuthService.refresh(req.body);
    res.json(session);
};

const forgotPassword = async (req, res) => {
    await AuthService.requestPasswordReset(req.body);
    // Misma respuesta exista o no la cuenta (no se revela qué emails están registrados).
    res.json({ message: 'Si el email está registrado, te enviamos un código. Revisa también la carpeta de spam.' });
};

const resetPassword = async (req, res) => {
    const result = await AuthService.resetPassword(req.body);
    res.json({ message: 'Contraseña actualizada', ...result });
};

module.exports = { register, login, logout, refresh, forgotPassword, resetPassword };
