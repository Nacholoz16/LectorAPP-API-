const ReadingService = require('../../services/reading.service');

// Controladores delgados: validación en middlewares, lógica y permisos en ReadingService.
// Los errores (NotFoundError, ForbiddenError, ...) los traduce el manejador global de app.js.

const create = async (req, res) => {
    const result = await ReadingService.registerReading(req.user.id, req.body);
    res.status(201).json(result);
};

const getGlobalFeed = async (req, res) => {
    const { limit, before_id } = req.validated.query;
    const feed = await ReadingService.getRecentReadings(limit, before_id, req.user.id);
    res.json(feed);
};

const getNewCount = async (req, res) => {
    const { after_id } = req.validated.query;
    res.json(await ReadingService.countNewReadings(after_id));
};

const getMyLibrary = async (req, res) => {
    const { page, limit } = req.validated.query;
    const library = await ReadingService.getMyLibrary(req.user.id, page, limit);
    res.json(library);
};

const update = async (req, res) => {
    const { id } = req.validated.params;
    const result = await ReadingService.updateReading(req.user.id, id, req.body);
    res.json(result);
};

const remove = async (req, res) => {
    const { id } = req.validated.params;
    const result = await ReadingService.deleteReading(req.user.id, id);
    res.json(result);
};

const toggleLike = async (req, res) => {
    const { id } = req.validated.params;
    const result = await ReadingService.toggleLike(req.user.id, id);
    res.json(result);
};

const recordSession = async (req, res) => {
    const { id } = req.validated.params;
    const result = await ReadingService.recordSession(req.user.id, id, req.body);
    res.json(result);
};

const getBookStats = async (req, res) => {
    const { id } = req.validated.params;
    const stats = await ReadingService.getBookStats(req.user.id, id);
    res.json(stats);
};

module.exports = {
    create,
    getGlobalFeed,
    getNewCount,
    getMyLibrary,
    update,
    delete: remove,
    toggleLike,
    recordSession,
    getBookStats,
};
