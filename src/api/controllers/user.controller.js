const UserService = require('../../services/user.service');

const getProfile = async (req, res) => {
    const { username } = req.validated.params;
    const profile = await UserService.getProfile(username, req.user.id);
    res.json(profile);
};

const getLibrary = async (req, res) => {
    const { username } = req.validated.params;
    const { page, limit } = req.validated.query;
    const library = await UserService.getLibrary(username, req.user.id, page, limit);
    res.json(library);
};

const getStats = async (req, res) => {
    const { username } = req.validated.params;
    const stats = await UserService.getStats(username, req.user.id);
    res.json(stats);
};

const setGoal = async (req, res) => {
    const result = await UserService.setReadingGoal(req.user.id, req.body.target_books);
    res.json(result);
};

const updatePrivacy = async (req, res) => {
    const result = await UserService.updatePrivacySettings(req.user.id, req.body);
    res.json(result);
};

module.exports = { getProfile, getLibrary, getStats, setGoal, updatePrivacy };
