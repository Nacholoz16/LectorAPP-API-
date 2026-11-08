const UserModel = require('../models/user.model');
const ReadingModel = require('../models/reading.model');
const { normalizeLog } = require('./reading.service');
const { NotFoundError } = require('../utils/errors');

const DEFAULT_PAGE_SIZE = 10;

class UserService {
    async _findUserOrFail(username) {
        const user = await UserModel.findByUsername(username);
        if (!user) throw new NotFoundError('Usuario no encontrado');
        return user;
    }

    /**
     * Biblioteca visible para `requestingUserId`:
     * - dueño: todo (público y privado)
     * - visitante + perfil privado: nada
     * - visitante + perfil público: solo lecturas públicas
     */
    async _libraryFor(targetUser, requestingUserId, page, limit) {
        const offset = (page - 1) * limit;

        let rows;
        if (requestingUserId === targetUser.id) {
            rows = await ReadingModel.getAllByUserId(targetUser.id, limit, offset);
        } else if (!targetUser.is_profile_public) {
            rows = [];
        } else {
            rows = await ReadingModel.getPublicByUserId(targetUser.id, limit, offset, requestingUserId);
        }
        return rows.map(normalizeLog);
    }

    async getProfile(username, requestingUserId) {
        const targetUser = await this._findUserOrFail(username);
        const isOwn = requestingUserId === targetUser.id;

        const profile = {
            username: targetUser.username,
            bio: targetUser.bio,
            avatar_url: targetUser.avatar_url,
            is_profile_public: Boolean(targetUser.is_profile_public),
            are_stats_public: Boolean(targetUser.are_stats_public),
            is_own_profile: isOwn,
            is_private_lock: !isOwn && !targetUser.is_profile_public,
            library: await this._libraryFor(targetUser, requestingUserId, 1, DEFAULT_PAGE_SIZE),
        };

        return profile;
    }

    async getLibrary(username, requestingUserId, page, limit) {
        const targetUser = await this._findUserOrFail(username);
        return this._libraryFor(targetUser, requestingUserId, page, limit);
    }

    async getStats(username, requestingUserId) {
        const targetUser = await this._findUserOrFail(username);

        const isOwn = requestingUserId === targetUser.id;
        if (!isOwn && (!targetUser.is_profile_public || !targetUser.are_stats_public)) {
            return { is_private: true };
        }

        const stats = await ReadingModel.getStatsByUserId(targetUser.id, !isOwn);
        return { ...stats, is_private: false };
    }

    async setReadingGoal(userId, targetBooks) {
        return ReadingModel.setReadingGoal(userId, targetBooks);
    }

    async updatePrivacySettings(userId, { is_profile_public, are_stats_public }) {
        await UserModel.updatePrivacy(userId, { is_profile_public, are_stats_public });
        return { success: true };
    }
}

module.exports = new UserService();
