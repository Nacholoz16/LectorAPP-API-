const BookService = require('../../services/book.service');

const search = async (req, res) => {
    const { q } = req.validated.query;
    const results = await BookService.search(q);
    res.json({ data: results });
};

const getFeed = async (req, res) => {
    const { external_id } = req.validated.query;
    const feed = await BookService.getBookFeed(external_id);
    res.json(feed);
};

module.exports = { search, getFeed };
