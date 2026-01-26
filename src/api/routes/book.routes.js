const express = require('express');
const router = express.Router();
const BookController = require('../controllers/book.controller');
const { protect } = require('../middlewares/auth.middleware');

// Rutas protegidas: Solo usuarios logueados pueden buscar
router.get('/search', protect, BookController.search);
router.get('/feed', BookController.getFeed);


module.exports = router;