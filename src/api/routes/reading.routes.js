const express = require('express');
const router = express.Router();
const ReadingController = require('../controllers/reading.controller');
const { protect } = require('../middlewares/auth.middleware');

// POST /api/readings (Protegido)
router.post('/', protect, ReadingController.create);
router.get('/feed', protect, ReadingController.getGlobalFeed);

module.exports = router;