const express = require('express');
const router = express.Router();
const ReadingController = require('../controllers/reading.controller');
const { protect } = require('../middlewares/auth.middleware');

router.post('/', protect, ReadingController.create);
router.get('/feed', protect, ReadingController.getGlobalFeed);
router.get('/my-library', protect, ReadingController.getMyLibrary); 
router.post('/:id/like', protect, ReadingController.toggleLike);
router.post('/:id/session', protect, ReadingController.recordSession);
router.get('/:id/stats', protect, ReadingController.getBookStats);
router.put('/:id', protect, ReadingController.update);
router.delete('/:id', protect, ReadingController.delete);
module.exports = router;