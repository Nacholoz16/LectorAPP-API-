const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const UserModel = require('../models/user.model');

class AuthService {
  
  async registerUser({ username, email, password }) { 
    console.log('Registering user:', email);
    // 1. Verificar duplicados
    const emailExists = await UserModel.findByEmail(email);
    if (emailExists) throw new Error('El email ya está registrado');

    const userExists = await UserModel.findByUsername(username);
    if (userExists) throw new Error('El nombre de usuario ya está ocupado');

    // 2. Encriptar contraseña (Cost factor 10 es estándar hoy)
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // 3. Crear usuario
    const userId = await UserModel.create({ username, email, passwordHash });

    // 4. Retornar datos (sin password) y Token inmediato (UX moderna)
    return {
      user: { id: userId, username, email },
      token: this.generateToken(userId)
    };
  }

  async loginUser({ email, password }) {
    // 1. Buscar usuario
    const user = await UserModel.findByEmail(email);
    if (!user) throw new Error('Credenciales inválidas');

    // 2. Verificar password
    const validPass = await bcrypt.compare(password, user.password_hash);
    if (!validPass) throw new Error('Credenciales inválidas');

    // 3. Generar respuesta
    return {
      user: { 
        id: user.id, 
        username: user.username, 
        email: user.email,
        avatar: user.avatar_url 
      },
      token: this.generateToken(user.id)
    };
  }

  // Helper para tokens
  generateToken(userId) {
    return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
      expiresIn: '7d' // Sesión dura 1 semana
    });
  }
}

module.exports = new AuthService();