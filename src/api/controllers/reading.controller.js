const ReadingService = require('../../services/reading.service');
const ReadingModel = require('../../models/reading.model'); // Importamos modelo directo para consultas simples

class ReadingController {

    async create(req, res) {
        try {
            const result = await ReadingService.registerReading(req.user.id, req.body);
            res.status(201).json(result);
        } catch (error) {
            res.status(400).json({ message: error.message });
        }
    }

    async getGlobalFeed(req, res) {
        try {
            const feed = await ReadingService.getRecentReadings();
            res.json(feed);
        } catch (error) {
            res.status(500).json({ message: 'Error al obtener feed' });
        }
    }

    // --- NUEVO MÉTODO ---
    async getMyLibrary(req, res) {
        try {
            const readings = await ReadingModel.getAllByUserId(req.user.id);
            // Normalización ligera
            const response = readings.map(r => ({
                ...r,
                authors: r.author || 'Desconocido'
            }));
            res.json(response);
        } catch (error) {
            res.status(500).json({ message: 'Error al obtener biblioteca' });
        }
    }
}

module.exports = new ReadingController();