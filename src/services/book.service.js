const BookModel = require('../models/book.model');
const OpenLibraryUtils = require('../utils/openLibrary');
const ReadingModel = require('../models/reading.model');

class BookService {
    async search(query) {
        if (!query) return [];

        // Buscamos en la caché local y en Open Library en paralelo.
        const [localResults, externalResults] = await Promise.all([
            BookModel.searchLocal(query),
            OpenLibraryUtils.searchBooks(query),
        ]);

        const normalizedLocal = localResults.map((book) => this._normalizeBook(book, 'local'));
        const localIds = new Set(normalizedLocal.map((b) => b.external_id));

        // Si ya lo tenemos en local, preferimos nuestra copia.
        const normalizedExternal = externalResults
            .filter((book) => !localIds.has(book.external_id))
            .map((book) => this._normalizeBook(book, 'api'));

        return [...normalizedLocal, ...normalizedExternal];
    }

    // Normaliza author/authors y google_id/external_id a un único formato.
    _normalizeBook(rawBook, source) {
        return {
            external_id: rawBook.external_id || rawBook.google_id,
            title: rawBook.title,
            authors: rawBook.authors || rawBook.author || 'Desconocido',
            cover_url: rawBook.cover_url,
            isbn: rawBook.isbn || null,
            page_count: rawBook.page_count || null,
            published_year: rawBook.published_year || null,
            is_local: source === 'local',
        };
    }

    async getBookFeed(externalId) {
        const localBook = await BookModel.findByExternalId(externalId);
        if (!localBook) return [];
        return ReadingModel.getPublicFeedByBookId(localBook.id);
    }
}

module.exports = new BookService();
