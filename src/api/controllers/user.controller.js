const UserService = require('../../services/user.service');

const getProfile = async (req, res, next) => {
    try {
        const { username } = req.params;
        const requestingUserId = req.user.id; // Viene del token (Middleware protect)

        const profile = await UserService.getProfile(username, requestingUserId);
        res.json(profile);
    } catch (error) {
        if (error.message === 'Usuario no encontrado') {
            return res.status(404).json({ error: error.message });
        }
        next(error);
    }
};

const getLibrary = async (req, res, next) => {
    try {
        const { username } = req.params;
        const requestingUserId = req.user.id;
        const page = req.query.page || 1;
        const limit = req.query.limit || 10;

        const library = await UserService.getLibrary(username, requestingUserId, page, limit);
        res.json(library);
    } catch (error) {
        if (error.message === 'Usuario no encontrado') {
            return res.status(404).json({ error: error.message });
        }
        next(error);
    }
};

const UserModel = require('../../models/user.model');
const ReadingModel = require('../../models/reading.model');

const getStats = async (req, res, next) => {
    try {
        const { username } = req.params;
        const requestingUserId = req.user.id;
        const stats = await UserService.getStats(username, requestingUserId);
        res.json(stats);
    } catch (error) {
        if (error.message === 'Usuario no encontrado') {
            return res.status(404).json({ error: error.message });
        }
        next(error);
    }
};

const setGoal = async (req, res, next) => {
    try {
        const { target_books } = req.body;
        if (!target_books || parseInt(target_books) <= 0) {
            return res.status(400).json({ error: 'Meta inválida' });
        }
        const result = await ReadingModel.setReadingGoal(req.user.id, parseInt(target_books));
        res.json(result);
    } catch (error) {
        next(error);
    }
};

const updatePrivacy = async (req, res, next) => {
    try {
        const { is_profile_public, are_stats_public } = req.body;
        const result = await UserService.updatePrivacySettings(req.user.id, {
            is_profile_public,
            are_stats_public
        });
        res.json(result);
    } catch (error) {
        next(error);
    }
};

module.exports = { getProfile, getLibrary, getStats, setGoal, updatePrivacy };