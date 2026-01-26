const UserModel = require('../models/user.model');
const ReadingModel = require('../models/reading.model');

class UserService {
    
    // Obtener perfil completo (Info + Biblioteca filtrada)
    async getProfile(targetUsername, requestingUserId) {
        // 1. Buscar al usuario objetivo
        const targetUser = await UserModel.findByUsername(targetUsername);
        if (!targetUser) throw new Error('Usuario no encontrado');

        // Datos básicos que SIEMPRE mostramos (Username, Avatar, Bio)
        // OJO: Nunca devolvemos el email ni password aquí.
        const profileData = {
            username: targetUser.username,
            bio: targetUser.bio,
            avatar_url: targetUser.avatar_url,
            is_profile_public: !!targetUser.is_profile_public, // Convertir a booleano real
            is_own_profile: false,
            library: []
        };

        // 2. ¿Es el dueño consultando su propio perfil?
        if (requestingUserId === targetUser.id) {
            profileData.is_own_profile = true;
            // El dueño ve TODO
            profileData.library = await ReadingModel.getAllByUserId(targetUser.id);
            return profileData;
        }

        // 3. Si NO es el dueño... revisamos la privacidad global
        if (!targetUser.is_profile_public) {
            // Perfil PRIVADO: Devolvemos biblioteca vacía y un flag
            // El frontend mostrará el candado.
            return { ...profileData, is_private_lock: true };
        }

        // 4. Perfil PÚBLICO: Devolvemos solo los libros públicos
        profileData.library = await ReadingModel.getPublicByUserId(targetUser.id);
        
        return profileData;
    }
}

module.exports = new UserService();