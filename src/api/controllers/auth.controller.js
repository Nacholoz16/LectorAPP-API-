const { z } = require('zod');
const AuthService = require('../../services/auth.service');

// Esquemas de Validación (Zod)
const registerSchema = z.object({
  username: z.string().min(3).max(30),
  email: z.string().email(),
  password: z.string().min(6) // Mínimo 6 caracteres
});

const loginSchema = z.union([
  z.object({
    email: z.string().email(),
    password: z.string()
  }),
  z.object({
    username: z.string().min(3).max(30),
    password: z.string()
  })
]);

// Métodos del Controlador
const register = async (req, res, next) => {
    console.log('Register request body:', req.body);
  try {
    // 1. Validar inputs
    const data = registerSchema.parse(req.body);

    // 2. Llamar al servicio
    const result = await AuthService.registerUser(data);

    // 3. Responder
    res.status(201).json({
      message: 'Usuario registrado exitosamente',
      ...result
    });
  } catch (error) {
    // Si es error de validación de Zod
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    // Si es error de negocio (duplicado)
    if (error.message.includes('ya está')) {
      return res.status(409).json({ error: error.message });
    }
    next(error);
  }
};

const logout = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || '';
    let token = null;

    if (authHeader.startsWith('Bearer ')) token = authHeader.slice(7);
    else if (req.body && req.body.token) token = req.body.token;
    else if (req.cookies && req.cookies.token) token = req.cookies.token;

    if (!token) return res.status(400).json({ error: 'Token requerido' });

    await AuthService.logout(token);

    res.json({ message: 'Logout exitoso', success: true });
  } catch (error) {
    if (error.message === 'Token inválido') {
      return res.status(401).json({ error: error.message });
    }
    next(error);
  }
};

const login = async (req, res, next) => {
  try {
    console.log('Login request body:', req.body);

    const data = loginSchema.parse(req.body);
    const result = await AuthService.loginUser(data);

    res.json({
      message: 'Login exitoso',
      ...result
    });
  } catch (error) {
    if (error.message === 'Credenciales inválidas') {
      return res.status(401).json({ error: error.message });
    }
    next(error);
  }
};

module.exports = { register, login, logout };