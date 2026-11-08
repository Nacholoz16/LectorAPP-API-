const db = require('../config/db');

class ReadingModel {
    // Crear un nuevo registro de lectura
    static async create(data) {
        const [result] = await db.execute(
            `INSERT INTO reading_logs 
            (user_id, book_id, status, rating, start_date, finish_date, duration_days, review_text, is_log_public, current_page) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [data.user_id, data.book_id, data.status, data.rating, data.start_date, data.finish_date, data.duration_days, data.review_text, data.is_log_public, data.current_page || 0]
        );
        return result.insertId;
    }

    // Verificar si el usuario ya registró este libro antes (para evitar duplicados o permitir re-lecturas)
    static async findByUserAndBook(userId, bookId) {
        const [rows] = await db.execute('SELECT * FROM reading_logs WHERE user_id = ? AND book_id = ?', [userId, bookId]);
        return rows[0];
    }

    // 1. OBTENER FEED PÚBLICO DE UN LIBRO
    // Solo trae registros marcados como públicos (is_log_public = 1)
    static async getPublicFeedByBookId(bookId) {
        const [rows] = await db.execute(`
            SELECT 
                r.id, r.status, r.rating, r.duration_days, r.review_text, r.current_page, r.updated_at,
                u.username, u.avatar_url, u.is_profile_public
            FROM reading_logs r
            JOIN users u ON r.user_id = u.id
            WHERE r.book_id = ? AND r.is_log_public = 1
            ORDER BY r.created_at DESC
        `, [bookId]);
        return rows;
    }

    // 2. OBTENER BIBLIOTECA DE UN USUARIO (Versión Dueño)
    // El dueño ve TODO (público y privado)
    static async getAllByUserId(userId, limit = 10, offset = 0, currentUserId = null) {
        const activeUserId = currentUserId || userId;
        const [rows] = await db.execute(`
            SELECT 
                r.*, 
                b.title, b.author, b.cover_url, b.external_id, b.page_count, b.isbn, b.published_year,
                COUNT(rl.id) AS likes_count,
                MAX(CASE WHEN rl.user_id = ? THEN 1 ELSE 0 END) AS has_liked
            FROM reading_logs r
            JOIN books b ON r.book_id = b.id
            LEFT JOIN reading_likes rl ON rl.reading_log_id = r.id
            WHERE r.user_id = ?
            GROUP BY r.id, b.title, b.author, b.cover_url, b.external_id, b.page_count, b.isbn, b.published_year
            ORDER BY r.created_at DESC
            LIMIT ? OFFSET ?
        `, [activeUserId.toString(), userId.toString(), limit.toString(), offset.toString()]);
        return rows;
    }

    // 3. OBTENER BIBLIOTECA DE UN USUARIO (Versión Visitante)
    // El visitante solo ve lo marcado como público
    static async getPublicByUserId(userId, limit = 10, offset = 0, currentUserId = null) {
        const activeUserId = currentUserId || 0;
        const [rows] = await db.execute(`
            SELECT 
                r.id, r.status, r.rating, r.duration_days, r.review_text, r.current_page, r.updated_at, r.is_log_public,
                b.title, b.author, b.cover_url, b.external_id, b.page_count,
                COUNT(rl.id) AS likes_count,
                MAX(CASE WHEN rl.user_id = ? THEN 1 ELSE 0 END) AS has_liked
            FROM reading_logs r
            JOIN books b ON r.book_id = b.id
            LEFT JOIN reading_likes rl ON rl.reading_log_id = r.id
            WHERE r.user_id = ? 
              AND r.is_log_public = 1
            GROUP BY r.id, b.title, b.author, b.cover_url, b.external_id, b.page_count
            ORDER BY r.created_at DESC
            LIMIT ? OFFSET ?
        `, [activeUserId.toString(), userId.toString(), limit.toString(), offset.toString()]);
        return rows;
    }

    // 4. FEED GLOBAL (Lo último que se ha leído en la plataforma)
    static async getGlobalFeed(limit = 10, offset = 0, currentUserId = null) {
        const activeUserId = currentUserId || 0;
        const [rows] = await db.execute(`
            SELECT 
                r.id, r.status, r.rating, r.review_text, r.current_page, r.created_at, r.duration_days,
                b.title, b.author, b.cover_url, b.external_id, b.isbn, b.page_count, b.published_year,
                u.username, u.avatar_url,
                COUNT(rl.id) AS likes_count,
                MAX(CASE WHEN rl.user_id = ? THEN 1 ELSE 0 END) AS has_liked
            FROM reading_logs r
            JOIN books b ON r.book_id = b.id
            JOIN users u ON r.user_id = u.id
            LEFT JOIN reading_likes rl ON rl.reading_log_id = r.id
            WHERE r.is_log_public = 1
            GROUP BY r.id, b.title, b.author, b.cover_url, b.external_id, b.isbn, b.page_count, b.published_year, u.username, u.avatar_url
            ORDER BY r.created_at DESC
            LIMIT ? OFFSET ?
        `, [activeUserId.toString(), limit.toString(), offset.toString()]);
        return rows;
    }

    // 5. DAR O QUITAR LIKE A UNA LECTURA
    static async toggleLike(userId, readingLogId) {
        const [logs] = await db.execute(
            'SELECT user_id, is_log_public FROM reading_logs WHERE id = ?',
            [readingLogId]
        );
        if (!logs.length) throw new Error('Registro no encontrado');
        if (logs[0].user_id !== userId && !logs[0].is_log_public) {
            throw new Error('No tienes permiso para interactuar con esta lectura');
        }

        const [existing] = await db.execute(
            'SELECT id FROM reading_likes WHERE user_id = ? AND reading_log_id = ?',
            [userId, readingLogId]
        );

        if (existing.length > 0) {
            await db.execute(
                'DELETE FROM reading_likes WHERE user_id = ? AND reading_log_id = ?',
                [userId, readingLogId]
            );
            const [count] = await db.execute(
                'SELECT COUNT(*) as likes_count FROM reading_likes WHERE reading_log_id = ?',
                [readingLogId]
            );
            return { liked: false, likes_count: count[0].likes_count };
        } else {
            await db.execute(
                'INSERT INTO reading_likes (user_id, reading_log_id) VALUES (?, ?)',
                [userId, readingLogId]
            );
            const [count] = await db.execute(
                'SELECT COUNT(*) as likes_count FROM reading_likes WHERE reading_log_id = ?',
                [readingLogId]
            );
            return { liked: true, likes_count: count[0].likes_count };
        }
    }

    static async update(id, userId, data) {
        const [result] = await db.execute(
            `UPDATE reading_logs 
             SET status = ?, rating = ?, start_date = ?, finish_date = ?, duration_days = ?, review_text = ?, is_log_public = ?, current_page = ?
             WHERE id = ? AND user_id = ?`,
            [
                data.status, 
                data.rating, 
                data.start_date || null, 
                data.finish_date || null, 
                data.duration_days, 
                data.review_text, 
                data.is_log_public, 
                data.current_page || 0,
                id, 
                userId
            ]
        );
        return result;
    }

    // Eliminar una lectura (Validando propiedad con user_id)
    static async delete(id, userId) {
        const [result] = await db.execute(
            'DELETE FROM reading_logs WHERE id = ? AND user_id = ?',
            [id, userId]
        );
        return result;
    }

    // 6. REGISTRAR SESIÓN DE LECTURA (Cronómetro / Minutos)
    static async recordSession(userId, readingLogId, durationMinutes, pagesRead, newCurrentPage) {
        const [logs] = await db.execute('SELECT user_id FROM reading_logs WHERE id = ?', [readingLogId]);
        if (!logs.length || logs[0].user_id !== userId) {
            throw new Error('No tienes permiso para registrar sesiones en esta lectura');
        }

        await db.execute(
            'INSERT INTO reading_sessions (user_id, reading_log_id, duration_minutes, pages_read) VALUES (?, ?, ?, ?)',
            [userId, readingLogId, durationMinutes, pagesRead]
        );

        if (newCurrentPage !== null && newCurrentPage !== undefined) {
            await db.execute(
                'UPDATE reading_logs SET current_page = ? WHERE id = ? AND user_id = ?',
                [newCurrentPage, readingLogId, userId]
            );
        }
        return { success: true };
    }

    // 7. OBTENER ESTADÍSTICAS DEL USUARIO (2 queries paralelas en vez de 7 secuenciales)
    static async getStatsByUserId(userId, isVisitor = false) {
        const currentYear = new Date().getFullYear();

        // Query 1: Todo lo de sesiones de lectura (tiempo + páginas)
        const sessionQueryStr = isVisitor
            ? `SELECT COALESCE(SUM(rs.duration_minutes), 0) as total_minutes, COALESCE(SUM(rs.pages_read), 0) as total_pages_sessions 
               FROM reading_sessions rs JOIN reading_logs rl ON rs.reading_log_id = rl.id 
               WHERE rs.user_id = ? AND rl.is_log_public = 1`
            : `SELECT COALESCE(SUM(duration_minutes), 0) as total_minutes, COALESCE(SUM(pages_read), 0) as total_pages_sessions 
               FROM reading_sessions WHERE user_id = ?`;

        const sessionQuery = db.execute(sessionQueryStr, [userId]);

        // Query 2: Todo lo de reading_logs + meta anual (en un solo JOIN)
        const logsFilter = isVisitor ? `AND rl.is_log_public = 1` : ``;
        const logsQuery = db.execute(
            `SELECT 
                COALESCE(SUM(rl.current_page), 0) as log_pages,
                COUNT(CASE WHEN rl.status = 'terminado' THEN 1 END) as finished_books,
                COUNT(CASE WHEN rl.status = 'terminado' 
                    AND (YEAR(rl.finish_date) = ? OR (rl.finish_date IS NULL AND YEAR(rl.created_at) = ?)) 
                    THEN 1 END) as finished_books_this_year,
                AVG(CASE WHEN rl.rating IS NOT NULL AND rl.rating > 0 THEN rl.rating END) as avg_rating,
                MAX(g.target_books) as target_books
            FROM reading_logs rl
            LEFT JOIN reading_goals g ON g.user_id = rl.user_id AND g.year = ?
            WHERE rl.user_id = ? ${logsFilter}`,
            [currentYear, currentYear, currentYear, userId]
        );

        // Query 3: Total de likes recibidos en sus logs
        const likesFilter = isVisitor ? `AND rl.is_log_public = 1` : ``;
        const likesQuery = db.execute(
            `SELECT COUNT(*) as total_likes 
             FROM reading_likes rlk 
             JOIN reading_logs rl ON rlk.reading_log_id = rl.id 
             WHERE rl.user_id = ? ${likesFilter}`,
            [userId]
        );

        // Ejecutar las 3 queries en paralelo
        const [[sessionRows], [logsRows], [likesRows]] = await Promise.all([sessionQuery, logsQuery, likesQuery]);
        const s = sessionRows[0];
        const l = logsRows[0];
        const k = likesRows[0];

        const totalPages = Math.max(
            parseInt(s.total_pages_sessions || 0),
            parseInt(l.log_pages || 0)
        );

        return {
            total_minutes: parseInt(s.total_minutes || 0),
            total_pages: totalPages,
            finished_books: parseInt(l.finished_books || 0),
            finished_books_this_year: parseInt(l.finished_books_this_year || 0),
            avg_rating: l.avg_rating ? parseFloat(l.avg_rating).toFixed(1) : '0.0',
            target_books_this_year: l.target_books ?? 10,
            total_likes: parseInt(k.total_likes || 0),
            year: currentYear
        };
    }

    // 8. FIJAR META ANUAL DE LECTURA
    static async setReadingGoal(userId, targetBooks) {
        const currentYear = new Date().getFullYear();
        await db.execute(
            `INSERT INTO reading_goals (user_id, year, target_books) 
             VALUES (?, ?, ?) 
             ON DUPLICATE KEY UPDATE target_books = ?`,
            [userId, currentYear, targetBooks, targetBooks]
        );
        return { success: true, target_books: targetBooks, year: currentYear };
    }
    // 9. OBTENER ESTADÍSTICAS DE UN LIBRO ESPECÍFICO
    static async getStatsByReadingLogId(readingLogId) {
        const [timeRows] = await db.execute(
            'SELECT COALESCE(SUM(duration_minutes), 0) as total_minutes, COUNT(*) as total_sessions, COALESCE(AVG(duration_minutes), 0) as avg_minutes FROM reading_sessions WHERE reading_log_id = ?',
            [readingLogId]
        );

        const [logRow] = await db.execute(
            'SELECT current_page, status, rating, review_text, created_at, finish_date FROM reading_logs WHERE id = ?',
            [readingLogId]
        );

        return {
            total_minutes: parseInt(timeRows[0].total_minutes || 0),
            total_sessions: parseInt(timeRows[0].total_sessions || 0),
            avg_session_minutes: Math.round(parseFloat(timeRows[0].avg_minutes || 0)),
            log_info: logRow[0] || null
        };
    }
}

module.exports = ReadingModel;