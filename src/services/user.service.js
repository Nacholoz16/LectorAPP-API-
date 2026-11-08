const UserModel = require('../models/user.model');
const ReadingModel = require('../models/reading.model');

class UserService {
    
    // Obtener perfil (Info básica)
    async getProfile(targetUsername, requestingUserId) {
        // 1. Buscar al usuario objetivo
        const targetUser = await UserModel.findByUsername(targetUsername);
        if (!targetUser) throw new Error('Usuario no encontrado');

        let libraryData = [];
        if (requestingUserId === targetUser.id || targetUser.is_profile_public) {
            libraryData = await this.getLibrary(targetUsername, requestingUserId, 1, 10);
        }

        const profileData = {
            username: targetUser.username,
            bio: targetUser.bio,
            avatar_url: targetUser.avatar_url,
            is_profile_public: !!targetUser.is_profile_public,
            are_stats_public: !!targetUser.are_stats_public,
            is_own_profile: requestingUserId === targetUser.id,
            library: libraryData
        };

        if (requestingUserId !== targetUser.id && !targetUser.is_profile_public) {
            profileData.is_private_lock = true;
        }

        return profileData;
    }

    // Obtener biblioteca paginada del usuario
    async getLibrary(targetUsername, requestingUserId, page = 1, limit = 10) {
        const targetUser = await UserModel.findByUsername(targetUsername);
        if (!targetUser) throw new Error('Usuario no encontrado');

        const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

        // 1. Si es el dueño, ve todo (público y privado)
        if (requestingUserId === targetUser.id) {
            return await ReadingModel.getAllByUserId(targetUser.id, parseInt(limit), offset);
        }

        // 2. Si no es el dueño y el perfil es privado
        if (!targetUser.is_profile_public) {
            return [];
        }

        // 3. Perfil público: solo libros públicos
        return await ReadingModel.getPublicByUserId(targetUser.id, parseInt(limit), offset);
    }

    // Obtener estadísticas considerando privacidad
    async getStats(targetUsername, requestingUserId) {
        const targetUser = await UserModel.findByUsername(targetUsername);
        if (!targetUser) throw new Error('Usuario no encontrado');

        const isOwn = requestingUserId === targetUser.id;
        if (!isOwn && (!targetUser.is_profile_public || !targetUser.are_stats_public)) {
            return { is_private: true };
        }

        const stats = await ReadingModel.getStatsByUserId(targetUser.id, !isOwn);
        stats.is_private = false;
        return stats;
    }

    // Actualizar configuración de privacidad
    async updatePrivacySettings(userId, { is_profile_public, are_stats_public }) {
        await UserModel.updatePrivacy(userId, { is_profile_public, are_stats_public });
        return { success: true };
    }
}

module.exports = new UserService();