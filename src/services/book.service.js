const BookModel = require('../models/book.model');
const OpenLibraryUtils = require('../utils/openLibrary');
const ReadingModel = require('../models/reading.model');

class BookService {

    async search(query) {
        if (!query) return [];

        // 1. Ejecutar búsquedas en paralelo (Local y Externa)
        const [localResults, externalResults] = await Promise.all([
            BookModel.searchLocal(query),       // Tu base de datos MySQL
            OpenLibraryUtils.searchBooks(query) // API OpenLibrary
        ]);

        // 2. Normalizar resultados locales (agregando bandera is_local)
        const normalizedLocal = localResults.map(book => 
            this._normalizeBook(book, 'local')
        );

        // 3. Crear un Set de IDs locales para filtrar duplicados rápidamente
        const localIds = new Set(normalizedLocal.map(b => b.external_id));

        // 4. Normalizar y Filtrar externos (solo los que NO estén ya en local)
        const normalizedExternal = externalResults
            .filter(book => !localIds.has(book.external_id))
            .map(book => this._normalizeBook(book, 'api'));

        // 5. Combinar: Locales primero (prioridad) + Externos nuevos
        return [...normalizedLocal, ...normalizedExternal];
    }

    // --- El Normalizador Universal (Privado) ---
    _normalizeBook(rawBook, source) {
        return {
            // Identificadores
            external_id: rawBook.external_id || rawBook.google_id, // Unificar ID
            
            // Datos principales (Resuelve la inconsistencia author vs authors)
            title: rawBook.title,
            authors: rawBook.authors || rawBook.author || 'Desconocido', 
            cover_url: rawBook.cover_url,
            
            // Metadatos opcionales
            isbn: rawBook.isbn || null,
            page_count: rawBook.page_count || null,
            published_year: rawBook.published_year || null,

            // Bandera útil para el frontend
            is_local: source === 'local'
        };
    }

    async cacheBook(bookData) {
        const bookToSave = {
            ...bookData,
            google_id: bookData.external_id
        };
        return await BookModel.create(bookToSave);
    }
    
    async getBookFeed(externalId) {
        const localBook = await BookModel.findByExternalId(externalId); 
        
        if (!localBook) {
            return [];
        }

        return await ReadingModel.getPublicFeedByBookId(localBook.id);
    }

}

module.exports = new BookService();