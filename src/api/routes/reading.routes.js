const express = require('express');
const router = express.Router();
const ReadingController = require('../controllers/reading.controller');
const { protect } = require('../middlewares/auth.middleware');

router.post('/', protect, ReadingController.create);
router.get('/feed', protect, ReadingController.getGlobalFeed);
router.get('/my-library', protect, ReadingController.getMyLibrary); // <--- Nueva Ruta

module.exports = router;