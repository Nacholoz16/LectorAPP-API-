const db = require('../config/db');

class UserModel {
  // Buscar usuario por Email
  static async findByEmail(email) {
    const [rows] = await db.execute(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );
    return rows[0];
  }

  // Buscar usuario por Username (para asegurar unicidad)
  static async findByUsername(username) {
    const [rows] = await db.execute(
      'SELECT * FROM users WHERE username = ?',
      [username]
    );
    return rows[0];
  }

  // Crear usuario nuevo
  static async create({ username, email, passwordHash }) {
    const [result] = await db.execute(
      `INSERT INTO users (username, email, password_hash, is_profile_public) 
       VALUES (?, ?, ?, 1)`, // Por defecto público (1) según tu requisito
      [username, email, passwordHash]
    );
    return result.insertId;
  }
  
  // Buscar por ID (útil para el middleware de auth)
  static async findById(id) {
    const [rows] = await db.execute(
      'SELECT id, username, email, avatar_url, is_profile_public FROM users WHERE id = ?',
      [id]
    );
    return rows[0];
  }
}

module.exports = UserModel;