const BookModel = require('../models/book.model');
const OpenLibraryUtils = require('../utils/openLibrary');
const ReadingModel = require('../models/reading.model');

class BookService {

    async search(query) {
        if (!query) return [];

        // 1. Paralelismo: Buscamos en casa y fuera de casa al mismo tiempo
        const [localResults, externalResults] = await Promise.all([
            BookModel.searchLocal(query),
            OpenLibraryUtils.searchBooks(query)
        ]);

        // 2. Normalizar resultados locales
        const normalizedLocal = localResults.map(book => this._normalizeBook(book, 'local'));

        // 3. Crear índice de IDs locales para filtrar duplicados
        const localIds = new Set(normalizedLocal.map(b => b.external_id));

        // 4. Normalizar y Filtrar externos (Solo los nuevos)
        const normalizedExternal = externalResults
            .filter(book => !localIds.has(book.external_id)) // Si ya lo tengo, uso el mío
            .map(book => this._normalizeBook(book, 'api'));

        // 5. Retornar mezcla (Locales primero)
        return [...normalizedLocal, ...normalizedExternal];
    }

    // --- El Normalizador Universal (Privado) ---
    _normalizeBook(rawBook, source) {
        return {
            external_id: rawBook.external_id || rawBook.google_id,
            title: rawBook.title,
            // Aquí arreglamos el problema de author vs authors para siempre
            authors: rawBook.authors || rawBook.author || 'Desconocido',
            cover_url: rawBook.cover_url,
            isbn: rawBook.isbn || null,
            page_count: rawBook.page_count || null,
            published_year: rawBook.published_year || null,
            is_local: source === 'local' // Bandera útil
        };
    }

    async cacheBook(bookData) {
        // Aseguramos que guardamos el ID correcto
        const bookToSave = {
            ...bookData,
            // Si viene del normalizador, ya trae 'external_id', pero nos aseguramos
            external_id: bookData.external_id || bookData.google_id
        };
        return await BookModel.create(bookToSave);
    }

    async getBookFeed(externalId) {
        const localBook = await BookModel.findByExternalId(externalId);
        if (!localBook) return [];
        return await ReadingModel.getPublicFeedByBookId(localBook.id);
    }

}

module.exports = new BookService();