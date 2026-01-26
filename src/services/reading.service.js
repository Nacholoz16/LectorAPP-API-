const ReadingModel = require('../models/reading.model');
const BookModel = require('../models/book.model');

class ReadingService {
    
    async registerReading(userId, inputData) {
        const { bookData, logData } = inputData;

        // PASO 1: Gestión del Libro (Caché)
        // Usamos el método create de BookModel que ya maneja "si existe, devuelve ID, si no, crea"
        // Asegúrate que tu BookModel.create use 'external_id' como definimos en el paso anterior.
        const bookId = await BookModel.create({
            external_id: bookData.external_id, // "/works/OL..."
            title: bookData.title,
            authors: bookData.authors,
            cover_url: bookData.cover_url,
            isbn: bookData.isbn,
            page_count: bookData.page_count
        });

        // PASO 2: Evitar duplicados (Opcional: podrías permitir relecturas)
        const existingLog = await ReadingModel.findByUserAndBook(userId, bookId);
        if (existingLog) {
            throw new Error('Ya tienes este libro registrado en tu biblioteca.');
        }

        // PASO 3: Cálculo automático de duración
        let calculatedDuration = logData.duration_days;

        if (logData.start_date && logData.finish_date && !calculatedDuration) {
            const start = new Date(logData.start_date);
            const end = new Date(logData.finish_date);
            const diffTime = Math.abs(end - start);
            calculatedDuration = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
        }

        // PASO 4: Guardar el Log
        const logId = await ReadingModel.create({
            user_id: userId,
            book_id: bookId,
            status: logData.status,
            rating: logData.rating,
            start_date: logData.start_date || null,
            finish_date: logData.finish_date || null,
            duration_days: calculatedDuration || 0,
            review_text: logData.review_text,
            is_log_public: logData.is_log_public
        });

        return { logId, message: 'Lectura registrada correctamente' };
    }

    // ...
    async getRecentReadings() {
        return await ReadingModel.getGlobalFeed(20);
    }
    // ...
}

module.exports = new ReadingService();