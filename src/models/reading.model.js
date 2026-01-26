const db = require('../config/db');

class ReadingModel {
    // Crear un nuevo registro de lectura
    static async create(data) {
        const [result] = await db.execute(
            `INSERT INTO reading_logs 
            (user_id, book_id, status, rating, start_date, finish_date, duration_days, review_text, is_log_public) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                data.user_id,
                data.book_id,
                data.status,       // 'leyendo', 'terminado', 'abandonado'
                data.rating,       // 1-5 o null
                data.start_date,
                data.finish_date,
                data.duration_days,
                data.review_text,
                data.is_log_public // boolean (1 o 0)
            ]
        );
        return result.insertId;
    }

    // Verificar si el usuario ya registró este libro antes (para evitar duplicados o permitir re-lecturas)
    static async findByUserAndBook(userId, bookId) {
        const [rows] = await db.execute(
            'SELECT * FROM reading_logs WHERE user_id = ? AND book_id = ?',
            [userId, bookId]
        );
        return rows[0];
    }

    // 1. OBTENER FEED PÚBLICO DE UN LIBRO
    // Solo trae registros marcados como públicos (is_log_public = 1)
    static async getPublicFeedByBookId(bookId) {
        const [rows] = await db.execute(`
            SELECT 
                r.id, r.status, r.rating, r.duration_days, r.review_text, r.updated_at,
                u.username, u.avatar_url, u.is_profile_public
            FROM reading_logs r
            JOIN users u ON r.user_id = u.id
            WHERE r.book_id = ? 
              AND r.is_log_public = 1
            ORDER BY r.created_at DESC
        `, [bookId]);
        return rows;
    }

    // 2. OBTENER BIBLIOTECA DE UN USUARIO (Versión Dueño)
    // El dueño ve TODO (público y privado)
    static async getAllByUserId(userId) {
        const [rows] = await db.execute(`
            SELECT 
                r.*, 
                b.title, b.author, b.cover_url, b.external_id, b.page_count
            FROM reading_logs r
            JOIN books b ON r.book_id = b.id
            WHERE r.user_id = ?
            ORDER BY r.created_at DESC
        `, [userId]);
        return rows;
    }

    // 3. OBTENER BIBLIOTECA DE UN USUARIO (Versión Visitante)
    // El visitante solo ve lo marcado como público
    static async getPublicByUserId(userId) {
        const [rows] = await db.execute(`
            SELECT 
                r.id, r.status, r.rating, r.duration_days, r.review_text, r.updated_at,
                b.title, b.author, b.cover_url, b.external_id, b.page_count
            FROM reading_logs r
            JOIN books b ON r.book_id = b.id
            WHERE r.user_id = ? 
              AND r.is_log_public = 1 -- FILTRO DE PRIVACIDAD
            ORDER BY r.created_at DESC
        `, [userId]);
        return rows;
    }

    // 4. FEED GLOBAL (Lo último que se ha leído en la plataforma)
    static async getGlobalFeed(limit = 20) {
        const [rows] = await db.execute(`
            SELECT 
                r.id, r.status, r.rating, r.review_text, r.created_at, r.duration_days,
                b.title, b.author, b.cover_url, b.external_id,
                u.username, u.avatar_url
            FROM reading_logs r
            JOIN books b ON r.book_id = b.id
            JOIN users u ON r.user_id = u.id
            WHERE r.is_log_public = 1 
            ORDER BY r.created_at DESC
            LIMIT ?
        `, [limit.toString()]); // cast a string para evitar conflictos en algunas versiones de mysql2
        return rows;
    }
}

module.exports = ReadingModel;