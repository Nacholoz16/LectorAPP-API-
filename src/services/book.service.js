const BookModel = require('../models/book.model');
const OpenLibraryUtils = require('../utils/openLibrary'); // <--- Cambio aquí

class BookService {
    async search(query) {
        if (!query) return [];

        // Buscamos en Open Library
        const externalResults = await OpenLibraryUtils.searchBooks(query);
        
        return externalResults;
    }

    // Adaptamos el método de guardado para usar el nuevo ID
    async cacheBook(bookData) {
        // Mapeamos el external_id de OL a nuestro modelo
        const bookToSave = {
            ...bookData,
            google_id: bookData.external_id // Usaremos la columna google_id para guardar el key de OL por ahora
        };
        return await BookModel.create(bookToSave);
    }
    
    async getBookFeed(externalId) {
        // 1. Buscar si tenemos el libro registrado en local
        // Nota: Necesitarás agregar findByExternalId en BookModel si no lo tienes,
        // o usar una query directa aquí. Asumamos que agregas findByExternalId en BookModel.
        const localBook = await BookModel.findByExternalId(externalId); 
        
        if (!localBook) {
            // Si nadie ha guardado el libro en nuestra app, no hay opiniones.
            return [];
        }

        // 2. Si existe, pedimos los logs públicos
        const ReadingModel = require('../models/reading.model'); // Importar aquí para evitar dependencias circulares
        return await ReadingModel.getPublicFeedByBookId(localBook.id);
    }

}

module.exports = new BookService();