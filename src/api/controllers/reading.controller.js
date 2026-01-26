const { z } = require('zod');
const ReadingService = require('../../services/reading.service');

// Esquema de Validación
const createLogSchema = z.object({
    bookData: z.object({
        external_id: z.string(),
        title: z.string(),
        authors: z.string(),
        cover_url: z.string().nullable().optional(),
        isbn: z.string().nullable().optional(),
        page_count: z.number().optional()
    }),
    logData: z.object({
        status: z.enum(['leyendo', 'terminado', 'abandonado']),
        rating: z.number().min(1).max(5).nullable().optional(), // Puede ser null
        review_text: z.string().optional(),
        start_date: z.string().optional(), // Esperamos formato YYYY-MM-DD
        finish_date: z.string().optional(),
        duration_days: z.number().optional(),
        is_log_public: z.boolean() // EL TOGGLE IMPORTANTE
    })
});

const create = async (req, res, next) => {
    try {
        // 1. Validar y parsear body
        const validData = createLogSchema.parse(req.body);
        
        // 2. Obtener ID del usuario del token (gracias al middleware 'protect')
        const userId = req.user.id;

        // 3. Llamar al servicio
        const result = await ReadingService.registerReading(userId, validData);

        res.status(201).json(result);

    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.errors });
        }
        next(error);
    }
};



const getGlobalFeed = async (req, res, next) => {
    try {
        const feed = await ReadingService.getRecentReadings();
        res.json(feed);
    } catch (error) {
        next(error);
    }
};

module.exports = { create, getGlobalFeed }; // Exportar ambos