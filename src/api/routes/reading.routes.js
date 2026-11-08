const express = require('express');
const ReadingController = require('../controllers/reading.controller');
const { protect } = require('../middlewares/auth.middleware');
const { validate } = require('../middlewares/validate');
const { paginationQuery, feedQuery, newCountQuery, idParam } = require('../validators/common');
const {
    createReadingSchema,
    updateReadingSchema,
    sessionSchema,
} = require('../validators/reading.validators');

const router = express.Router();

router.use(protect);

router.post('/', validate({ body: createReadingSchema }), ReadingController.create);
router.get('/feed', validate({ query: feedQuery }), ReadingController.getGlobalFeed);
router.get('/feed/new-count', validate({ query: newCountQuery }), ReadingController.getNewCount);
router.get('/my-library', validate({ query: paginationQuery }), ReadingController.getMyLibrary);
router.post('/:id/like', validate({ params: idParam }), ReadingController.toggleLike);
router.post('/:id/session', validate({ params: idParam, body: sessionSchema }), ReadingController.recordSession);
router.get('/:id/stats', validate({ params: idParam }), ReadingController.getBookStats);
router.put('/:id', validate({ params: idParam, body: updateReadingSchema }), ReadingController.update);
router.delete('/:id', validate({ params: idParam }), ReadingController.delete);

module.exports = router;
