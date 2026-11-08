const db = require('../config/db');

class UserModel {
    // Incluye password_hash: solo para uso interno (login). Nunca devolver al cliente.
    static async findByEmail(email) {
        const [rows] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);
        return rows[0];
    }

    // Incluye password_hash: solo para uso interno. Nunca devolver al cliente tal cual.
    static async findByUsername(username) {
        const [rows] = await db.execute('SELECT * FROM users WHERE username = ?', [username]);
        return rows[0];
    }

    static async create({ username, email, passwordHash }) {
        const [result] = await db.execute(
            `INSERT INTO users (username, email, password_hash, is_profile_public)
             VALUES (?, ?, ?, 1)`, // Perfil público por defecto
            [username, email, passwordHash]
        );
        return result.insertId;
    }

    // Usado por el middleware de auth: sin password_hash.
    static async findById(id) {
        const [rows] = await db.execute(
            'SELECT id, username, email, avatar_url, is_profile_public, are_stats_public FROM users WHERE id = ?',
            [id]
        );
        return rows[0];
    }

    // COALESCE: los campos no enviados (null) conservan su valor actual.
    static async updatePrivacy(id, { is_profile_public, are_stats_public }) {
        await db.execute(
            `UPDATE users
             SET is_profile_public = COALESCE(?, is_profile_public),
                 are_stats_public = COALESCE(?, are_stats_public)
             WHERE id = ?`,
            [
                is_profile_public !== undefined ? (is_profile_public ? 1 : 0) : null,
                are_stats_public !== undefined ? (are_stats_public ? 1 : 0) : null,
                id,
            ]
        );
    }
}

module.exports = UserModel;
