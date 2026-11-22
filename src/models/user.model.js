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

    /** `termsVersion`: versión de los términos que aceptó al registrarse (se guarda con la fecha). */
    static async create({ username, email, passwordHash, termsVersion }) {
        const [result] = await db.execute(
            `INSERT INTO users (username, email, password_hash, is_profile_public, terms_version, terms_accepted_at)
             VALUES (?, ?, ?, 1, ?, NOW())`, // Perfil público por defecto
            [username, email, passwordHash, termsVersion]
        );
        return result.insertId;
    }

    /** Versión de los términos aceptada (null si nunca aceptó). `undefined` si no existe. */
    static async getTermsVersion(id) {
        const [rows] = await db.execute('SELECT terms_version FROM users WHERE id = ?', [id]);
        return rows[0] ? rows[0].terms_version : undefined;
    }

    /**
     * Registra la aceptación de `version`. Si ya tenía aceptada esa misma versión no cambia nada:
     * se conserva la fecha de la PRIMERA aceptación (es la que sirve como constancia).
     */
    static async acceptTerms(id, version) {
        await db.execute(
            `UPDATE users SET terms_version = ?, terms_accepted_at = NOW()
             WHERE id = ? AND (terms_version IS NULL OR terms_version <> ?)`,
            [version, id, version]
        );
        const [rows] = await db.execute(
            'SELECT terms_version, terms_accepted_at FROM users WHERE id = ?',
            [id]
        );
        return rows[0];
    }

    // Usado por el middleware de auth: sin password_hash.
    static async findById(id) {
        const [rows] = await db.execute(
            'SELECT id, username, email, avatar_url, is_profile_public, are_stats_public, password_changed_at FROM users WHERE id = ?',
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
