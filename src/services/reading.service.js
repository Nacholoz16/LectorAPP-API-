const db = require('../config/db');
const ReadingModel = require('../models/reading.model');
const BookModel = require('../models/book.model');
const {
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ValidationError,
    isDuplicateEntry,
} = require('../utils/errors');

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Días entre dos fechas 'YYYY-MM-DD' (ya validadas en orden). 0 si falta alguna. */
const computeDurationDays = (startDate, finishDate) => {
    if (!startDate || !finishDate) return 0;
    return Math.round((Date.parse(finishDate) - Date.parse(startDate)) / MS_PER_DAY);
};

/**
 * Normaliza una fila de reading_logs para el cliente: tipos consistentes
 * (booleanos reales en vez de 1/0, números en vez de strings de COUNT) y `authors`.
 */
const normalizeLog = (row) => ({
    ...row,
    authors: row.authors || row.author || 'Desconocido',
    likes_count: Number(row.likes_count || 0),
    has_liked: Boolean(Number(row.has_liked || 0)),
    ...(row.is_log_public !== undefined && { is_log_public: Boolean(row.is_log_public) }),
});

/** Ejecuta `work(conn)` dentro de una transacción. */
const withTransaction = async (work) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const result = await work(conn);
        await conn.commit();
        return result;
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
};

class ReadingService {
    /** Lanza 404 si el log no existe y 403 si no pertenece a `userId`. */
    async _getOwnedLog(userId, logId) {
        const log = await ReadingModel.findAccessInfo(logId);
        if (!log) throw new NotFoundError('Lectura no encontrada');
        if (log.user_id !== userId) {
            throw new ForbiddenError('No tienes permiso para modificar esta lectura');
        }
        return log;
    }

    /** Lanza 404 si no existe y 403 si es privado y de otro usuario. */
    async _getReadableLog(userId, logId) {
        const log = await ReadingModel.findAccessInfo(logId);
        if (!log) throw new NotFoundError('Lectura no encontrada');
        if (log.user_id !== userId && !log.is_log_public) {
            throw new ForbiddenError('No tienes permiso para acceder a esta lectura');
        }
        return log;
    }

    async registerReading(userId, { bookData, logData }) {
        return withTransaction(async (conn) => {
            const bookId = await BookModel.findOrCreate(bookData, conn);

            const existing = await ReadingModel.findByUserAndBook(userId, bookId, conn);
            if (existing) throw new ConflictError('Ya tienes este libro registrado.');

            let logId;
            try {
                logId = await ReadingModel.create({
                    user_id: userId,
                    book_id: bookId,
                    status: logData.status,
                    rating: logData.rating,
                    start_date: logData.start_date,
                    finish_date: logData.finish_date,
                    duration_days: computeDurationDays(logData.start_date, logData.finish_date),
                    review_text: logData.review_text,
                    is_log_public: logData.is_log_public,
                    current_page: logData.current_page,
                }, conn);
            } catch (error) {
                if (isDuplicateEntry(error)) throw new ConflictError('Ya tienes este libro registrado.');
                throw error;
            }

            return { logId, message: 'Lectura registrada correctamente' };
        });
    }

    async getRecentReadings(limit, beforeId, currentUserId) {
        const rows = await ReadingModel.getGlobalFeed(limit, beforeId, currentUserId);
        return rows.map(normalizeLog);
    }

    async countNewReadings(afterId) {
        return { count: await ReadingModel.countPublicNewerThan(afterId) };
    }

    async getMyLibrary(userId, page, limit) {
        const offset = (page - 1) * limit;
        const rows = await ReadingModel.getAllByUserId(userId, limit, offset);
        return rows.map(normalizeLog);
    }

    /** `changes` es un update parcial validado: solo trae los campos enviados. */
    async updateReading(userId, logId, changes) {
        const current = await this._getOwnedLog(userId, logId);

        // Las fechas pueden venir solo una de las dos: validar el orden con los valores finales.
        const startDate = changes.start_date !== undefined ? changes.start_date : current.start_date;
        const finishDate = changes.finish_date !== undefined ? changes.finish_date : current.finish_date;
        if (startDate && finishDate && finishDate < startDate) {
            throw new ValidationError('La fecha de término no puede ser anterior a la de inicio');
        }

        const fields = { ...changes };
        if (changes.start_date !== undefined || changes.finish_date !== undefined) {
            fields.duration_days = computeDurationDays(startDate, finishDate);
        }

        await ReadingModel.update(logId, userId, fields);
        return { message: 'Opinión actualizada correctamente' };
    }

    async deleteReading(userId, logId) {
        await this._getOwnedLog(userId, logId);
        await ReadingModel.delete(logId, userId);
        return { message: 'Opinión eliminada correctamente' };
    }

    async toggleLike(userId, logId) {
        await this._getReadableLog(userId, logId);
        return ReadingModel.toggleLike(userId, logId);
    }

    async recordSession(userId, logId, { duration_minutes, pages_read, current_page }) {
        await this._getOwnedLog(userId, logId);

        await withTransaction(async (conn) => {
            await ReadingModel.insertSession(userId, logId, duration_minutes, pages_read, conn);
            if (current_page !== null && current_page !== undefined) {
                await ReadingModel.update(logId, userId, { current_page }, conn);
            }
        });

        return { success: true };
    }

    async getBookStats(userId, logId) {
        await this._getReadableLog(userId, logId);
        return ReadingModel.getStatsByReadingLogId(logId);
    }
}

module.exports = new ReadingService();
module.exports.normalizeLog = normalizeLog;
