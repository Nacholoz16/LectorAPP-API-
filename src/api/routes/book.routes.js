const express = require('express');
const rateLimit = require('express-rate-limit');
const BookController = require('../controllers/book.controller');
const { protect } = require('../middlewares/auth.middleware');
const { validate } = require('../middlewares/validate');
const { searchQuery, bookFeedQuery } = require('../validators/book.validators');

const router = express.Router();

// Cada búsqueda consulta Open Library: límite propio para no abusar del servicio externo.
const searchLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
    message: { error: 'Demasiadas búsquedas, espera un momento.', code: 'RATE_LIMITED' },
});

// Búsqueda: solo usuarios logueados.
router.get('/search', protect, searchLimiter, validate({ query: searchQuery }), BookController.search);
// Reseñas públicas de un libro: abierto (lo usa la web pública https://nacholoz3d.cl/libro/<id>).
router.get('/feed', validate({ query: bookFeedQuery }), BookController.getFeed);

module.exports = router;
