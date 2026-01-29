const ReadingModel = require('../models/reading.model');
const BookModel = require('../models/book.model');

class ReadingService {
    
    async registerReading(userId, inputData) {
        const { bookData, logData } = inputData;

        // 1. Guardar/Recuperar Libro
        const bookId = await BookModel.create({
            external_id: bookData.external_id,
            title: bookData.title,
            authors: bookData.authors, // El frontend ya lo enviará bien
            cover_url: bookData.cover_url,
            isbn: bookData.isbn,
            page_count: bookData.page_count,
            published_year: bookData.published_year // <--- Guardamos el año
        });

        // 2. Validar duplicados
        const existingLog = await ReadingModel.findByUserAndBook(userId, bookId);
        if (existingLog) throw new Error('Ya tienes este libro registrado.');

        // 3. Duración
        let calculatedDuration = logData.duration_days;
        if (logData.start_date && logData.finish_date && !calculatedDuration) {
            const start = new Date(logData.start_date);
            const end = new Date(logData.finish_date);
            calculatedDuration = Math.ceil(Math.abs(end - start) / (1000 * 60 * 60 * 24)); 
        }

        // 4. Guardar Log
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

    async getRecentReadings() {
        const rawFeed = await ReadingModel.getGlobalFeed(20);
        
        // Estandarización final antes de enviar al frontend
        return rawFeed.map(item => ({
            ...item,
            authors: item.authors || item.author || 'Desconocido', // Unificación
            external_id: item.external_id // Ya viene bien del modelo
        }));
    }
}

module.exports = new ReadingService();