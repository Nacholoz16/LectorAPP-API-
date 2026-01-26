const BookService = require('../../services/book.service');

const search = async (req, res, next) => {
    try {
        const { q } = req.query; // ?q=Harry Potter
        
        if (!q) {
            return res.status(400).json({ error: 'Debes enviar un término de búsqueda (?q=...)' });
        }

        const results = await BookService.search(q);
        res.json({ data: results });
    } catch (error) {
        next(error);
    }
};

const getFeed = async (req, res, next) => {
    try {
        const { external_id } = req.query; // ?external_id=/works/OL123
        if (!external_id) return res.status(400).json({ error: 'Falta external_id' });

        const feed = await BookService.getBookFeed(external_id);
        res.json(feed);
    } catch (error) {
        next(error);
    }
};

module.exports = { search, getFeed };