const { z } = require('zod');

const searchQuery = z.object({
    q: z.string().trim().min(1, 'Debes enviar un término de búsqueda (?q=...)').max(200),
});

const bookFeedQuery = z.object({
    external_id: z.string().trim().min(1, 'Falta external_id').max(100),
});

module.exports = { searchQuery, bookFeedQuery };
