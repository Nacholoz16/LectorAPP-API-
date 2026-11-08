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
            const page = req.query.page || 1;
            const limit = req.query.limit || 10;
            const currentUserId = req.user ? req.user.id : null;
            const feed = await ReadingService.getRecentReadings(page, limit, currentUserId);
            res.json(feed);
        } catch (error) {
            res.status(500).json({ message: 'Error al obtener feed' });
        }
    }

    // --- NUEVO MÉTODO ---
    async getMyLibrary(req, res) {
        try {
            const page = req.query.page || 1;
            const limit = req.query.limit || 10;
            const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
            const readings = await ReadingModel.getAllByUserId(req.user.id, parseInt(limit), offset);
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

    async toggleLike(req, res) {
        try {
            const { id } = req.params;
            const result = await ReadingService.toggleLike(req.user.id, id);
            res.json(result);
        } catch (error) {
            if (error.message.includes('No tienes permiso')) {
                return res.status(403).json({ error: error.message });
            }
            if (error.message.includes('no encontrado')) {
                return res.status(404).json({ error: error.message });
            }
            res.status(400).json({ message: error.message });
        }
    }

    async recordSession(req, res) {
        try {
            const { id } = req.params;
            const { duration_minutes, pages_read, current_page } = req.body;
            const result = await ReadingModel.recordSession(
                req.user.id,
                id,
                parseInt(duration_minutes || 0),
                parseInt(pages_read || 0),
                current_page !== undefined ? parseInt(current_page) : null
            );
            res.json(result);
        } catch (error) {
            if (error.message.includes('No tienes permiso')) {
                return res.status(403).json({ error: error.message });
            }
            res.status(400).json({ message: error.message });
        }
    }

    async getBookStats(req, res) {
        try {
            const { id } = req.params;
            // Verificar que el log pertenece al usuario o es público
            const [rows] = await require('../../config/db').execute(
                'SELECT user_id, is_log_public FROM reading_logs WHERE id = ?',
                [id]
            );
            if (!rows.length) {
                return res.status(404).json({ error: 'Registro no encontrado' });
            }
            const log = rows[0];
            if (log.user_id !== req.user.id && !log.is_log_public) {
                return res.status(403).json({ error: 'No tienes permiso para ver estas estadísticas' });
            }
            const stats = await ReadingModel.getStatsByReadingLogId(id);
            res.json(stats);
        } catch (error) {
            res.status(400).json({ message: error.message });
        }
    }
}

module.exports = new ReadingController();