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

    // --- AGREGAR ESTOS MÉTODOS ---

    async update(req, res) {
        try {
            const { id } = req.params; // ID del log de lectura
            const result = await ReadingService.updateReading(req.user.id, id, req.body);
            res.json(result);
        } catch (error) {
            if (error.message.includes('no tienes permiso')) {
                return res.status(403).json({ error: error.message });
            }
            res.status(400).json({ message: error.message });
        }
    }

    async delete(req, res) {
        try {
            const { id } = req.params; // ID del log de lectura
            const result = await ReadingService.deleteReading(req.user.id, id);
            res.json(result);
        } catch (error) {
            if (error.message.includes('no tienes permiso')) {
                return res.status(403).json({ error: error.message });
            }
            res.status(400).json({ message: error.message });
        }
    }
}

module.exports = new ReadingController();