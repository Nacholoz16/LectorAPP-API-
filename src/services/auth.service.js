const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const UserModel = require('../models/user.model');
const db = require('../config/db');
const { signToken, hashToken } = require('../utils/tokens');
const { ConflictError, UnauthorizedError, isDuplicateEntry } = require('../utils/errors');

const BCRYPT_ROUNDS = 10;

// Hash ficticio para comparar cuando el usuario no existe: así el login tarda lo mismo
// exista o no la cuenta, y no se pueden enumerar usuarios midiendo tiempos de respuesta.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('dummy-password-for-timing-safety', BCRYPT_ROUNDS);

class AuthService {
    /** `data` ya viene validado y normalizado (email en minúsculas) por registerSchema. */
    async registerUser({ username, email, password }) {
        const [emailExists, usernameExists] = await Promise.all([
            UserModel.findByEmail(email),
            UserModel.findByUsername(username),
        ]);
        if (emailExists) throw new ConflictError('El email ya está registrado');
        if (usernameExists) throw new ConflictError('El nombre de usuario ya está ocupado');

        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

        let userId;
        try {
            userId = await UserModel.create({ username, email, passwordHash });
        } catch (error) {
            // Dos registros simultáneos con el mismo email/username: lo resuelve el UNIQUE de la BD.
            if (isDuplicateEntry(error)) {
                throw new ConflictError('El email o nombre de usuario ya está registrado');
            }
            throw error;
        }

        return {
            user: { id: userId, username, email },
            token: signToken(userId),
        };
    }

    async loginUser({ email, username, password }) {
        const user = email
            ? await UserModel.findByEmail(email)
            : await UserModel.findByUsername(username);

        // Siempre se ejecuta bcrypt.compare (ver DUMMY_PASSWORD_HASH).
        const validPassword = await bcrypt.compare(
            password,
            user ? user.password_hash : DUMMY_PASSWORD_HASH
        );

        if (!user || !validPassword) {
            throw new UnauthorizedError('Credenciales inválidas');
        }

        return {
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                avatar: user.avatar_url,
            },
            token: signToken(user.id),
        };
    }

    /** Revoca un token ya verificado por el middleware `protect`. */
    async logout(token) {
        const { exp } = jwt.decode(token);
        const expiresAt = new Date(exp * 1000);

        await db.execute(
            'INSERT IGNORE INTO token_blacklist (token, expires_at) VALUES (?, ?)',
            [hashToken(token), expiresAt]
        );

        return { success: true };
    }
}

module.exports = new AuthService();
