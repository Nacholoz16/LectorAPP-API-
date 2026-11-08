const db = require('../config/db');
const { isDuplicateEntry } = require('../utils/errors');

// Columnas que un UPDATE parcial puede modificar (lista blanca: nunca interpolar claves del cliente).
const UPDATABLE_COLUMNS = new Set([
    'status',
    'rating',
    'review_text',
    'start_date',
    'finish_date',
    'duration_days',
    'is_log_public',
    'current_page',
]);

class ReadingModel {
    // Crear un nuevo registro de lectura
    static async create(data, conn = db) {
        const [result] = await conn.execute(
            `INSERT INTO reading_logs
            (user_id, book_id, status, rating, start_date, finish_date, duration_days, review_text, is_log_public, current_page)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                data.user_id,
                data.book_id,
                data.status,
                data.rating ?? null,
                data.start_date ?? null,
                data.finish_date ?? null,
                data.duration_days ?? 0,
                data.review_text ?? null,
                data.is_log_public ? 1 : 0,
                data.current_page ?? 0,
            ]
        );
        return result.insertId;
    }

    static async findByUserAndBook(userId, bookId, conn = db) {
        const [rows] = await conn.execute(
            'SELECT id FROM reading_logs WHERE user_id = ? AND book_id = ?',
            [userId, bookId]
        );
        return rows[0];
    }

    /** Datos mínimos para comprobar permisos (dueño / visibilidad) y fechas actuales. */
    static async findAccessInfo(id) {
        const [rows] = await db.execute(
            `SELECT id, user_id, is_log_public,
                    DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date,
                    DATE_FORMAT(finish_date, '%Y-%m-%d') AS finish_date
             FROM reading_logs WHERE id = ?`,
            [id]
        );
        return rows[0];
    }

    // 1. FEED PÚBLICO DE UN LIBRO (solo registros públicos)
    static async getPublicFeedByBookId(bookId) {
        const [rows] = await db.execute(`
            SELECT
                r.id, r.status, r.rating, r.duration_days, r.review_text, r.current_page, r.updated_at,
                u.username, u.avatar_url, u.is_profile_public
            FROM reading_logs r
            JOIN users u ON r.user_id = u.id
            WHERE r.book_id = ? AND r.is_log_public = 1
            ORDER BY r.created_at DESC
            LIMIT 100
        `, [bookId]);
        return rows;
    }

    // Likes por subconsulta correlacionada en vez de LEFT JOIN + GROUP BY:
    // cada fila resuelve 2 búsquedas por índice (idx_likes_log_user / unique_user_reading_like)
    // y MySQL ya no necesita una tabla temporal para agrupar.
    static _likesColumns() {
        return `
            (SELECT COUNT(*) FROM reading_likes lc WHERE lc.reading_log_id = r.id) AS likes_count,
            EXISTS(SELECT 1 FROM reading_likes lh WHERE lh.reading_log_id = r.id AND lh.user_id = ?) AS has_liked`;
    }

    // 2. BIBLIOTECA DE UN USUARIO (versión dueño: público y privado)
    static async getAllByUserId(userId, limit = 10, offset = 0) {
        const [rows] = await db.execute(`
            SELECT
                r.*,
                b.title, b.author, b.cover_url, b.external_id, b.page_count, b.isbn, b.published_year,
                ${this._likesColumns()}
            FROM reading_logs r
            JOIN books b ON r.book_id = b.id
            WHERE r.user_id = ?
            ORDER BY r.created_at DESC
            LIMIT ? OFFSET ?
        `, [String(userId), String(userId), String(limit), String(offset)]);
        return rows;
    }

    // 3. BIBLIOTECA DE UN USUARIO (versión visitante: solo lo público)
    static async getPublicByUserId(userId, limit = 10, offset = 0, currentUserId = null) {
        const [rows] = await db.execute(`
            SELECT
                r.id, r.status, r.rating, r.duration_days, r.review_text, r.current_page, r.updated_at, r.is_log_public,
                b.title, b.author, b.cover_url, b.external_id, b.page_count,
                ${this._likesColumns()}
            FROM reading_logs r
            JOIN books b ON r.book_id = b.id
            WHERE r.user_id = ?
              AND r.is_log_public = 1
            ORDER BY r.created_at DESC
            LIMIT ? OFFSET ?
        `, [String(currentUserId || 0), String(userId), String(limit), String(offset)]);
        return rows;
    }

    /**
     * 4. FEED GLOBAL con paginación por cursor.
     * `beforeId` = id del último elemento ya mostrado (null para la primera página).
     * A diferencia de OFFSET, no duplica ni salta publicaciones cuando entran nuevas
     * mientras el usuario hace scroll, y su costo no crece con la página.
     * Usa el índice idx_logs_public_id (is_log_public, id).
     */
    static async getGlobalFeed(limit = 10, beforeId = null, currentUserId = null) {
        const cursorFilter = beforeId ? 'AND r.id < ?' : '';
        const params = [String(currentUserId || 0)];
        if (beforeId) params.push(String(beforeId));
        params.push(String(limit));

        const [rows] = await db.execute(`
            SELECT
                r.id, r.status, r.rating, r.review_text, r.current_page, r.created_at, r.duration_days,
                b.title, b.author, b.cover_url, b.external_id, b.isbn, b.page_count, b.published_year,
                u.username, u.avatar_url,
                ${this._likesColumns()}
            FROM reading_logs r
            JOIN books b ON r.book_id = b.id
            JOIN users u ON r.user_id = u.id
            WHERE r.is_log_public = 1 ${cursorFilter}
            ORDER BY r.id DESC
            LIMIT ?
        `, params);
        return rows;
    }

    /** Cuántas publicaciones públicas hay más nuevas que `afterId` (banner "X nuevas publicaciones"). */
    static async countPublicNewerThan(afterId) {
        const [rows] = await db.execute(
            'SELECT COUNT(*) AS count FROM reading_logs WHERE is_log_public = 1 AND id > ?',
            [afterId]
        );
        return Number(rows[0].count);
    }

    /**
     * 5. DAR O QUITAR LIKE (los permisos se comprueban en el servicio).
     * Primero intenta borrar; si no había like, inserta. Cada sentencia es atómica y el
     * UNIQUE(user_id, reading_log_id) evita duplicados aunque lleguen dos taps simultáneos.
     */
    static async toggleLike(userId, readingLogId) {
        const [deleted] = await db.execute(
            'DELETE FROM reading_likes WHERE user_id = ? AND reading_log_id = ?',
            [userId, readingLogId]
        );

        let liked = false;
        if (deleted.affectedRows === 0) {
            try {
                await db.execute(
                    'INSERT INTO reading_likes (user_id, reading_log_id) VALUES (?, ?)',
                    [userId, readingLogId]
                );
            } catch (error) {
                if (!isDuplicateEntry(error)) throw error;
            }
            liked = true;
        }

        const [count] = await db.execute(
            'SELECT COUNT(*) AS likes_count FROM reading_likes WHERE reading_log_id = ?',
            [readingLogId]
        );
        return { liked, likes_count: Number(count[0].likes_count) };
    }

    /** UPDATE parcial: solo las columnas presentes en `fields` (y permitidas). */
    static async update(id, userId, fields, conn = db) {
        const entries = Object.entries(fields).filter(
            ([column, value]) => UPDATABLE_COLUMNS.has(column) && value !== undefined
        );
        if (entries.length === 0) return { affectedRows: 0 };

        const setClause = entries.map(([column]) => `${column} = ?`).join(', ');
        const values = entries.map(([column, value]) =>
            column === 'is_log_public' ? (value ? 1 : 0) : value
        );

        const [result] = await conn.execute(
            `UPDATE reading_logs SET ${setClause} WHERE id = ? AND user_id = ?`,
            [...values, id, userId]
        );
        return result;
    }

    // Eliminar una lectura (validando propiedad con user_id)
    static async delete(id, userId) {
        const [result] = await db.execute(
            'DELETE FROM reading_logs WHERE id = ? AND user_id = ?',
            [id, userId]
        );
        return result;
    }

    // 6. REGISTRAR SESIÓN DE LECTURA (los permisos se comprueban en el servicio)
    static async insertSession(userId, readingLogId, durationMinutes, pagesRead, conn = db) {
        await conn.execute(
            'INSERT INTO reading_sessions (user_id, reading_log_id, duration_minutes, pages_read) VALUES (?, ?, ?, ?)',
            [userId, readingLogId, durationMinutes, pagesRead]
        );
    }

    /**
     * 7. ESTADÍSTICAS DEL USUARIO (3 queries en paralelo).
     *
     * total_pages (fuente única de verdad): por cada lectura,
     *   - terminada y con page_count conocido → page_count del libro
     *   - en otro caso → current_page (hasta dónde llegó)
     * Las sesiones solo aportan el tiempo (total_minutes); sus pages_read no se suman
     * para no contar dos veces las mismas páginas.
     */
    static async getStatsByUserId(userId, isVisitor = false) {
        const currentYear = new Date().getFullYear();
        const publicOnly = isVisitor ? 'AND rl.is_log_public = 1' : '';

        const sessionQuery = db.execute(
            `SELECT COALESCE(SUM(rs.duration_minutes), 0) AS total_minutes
             FROM reading_sessions rs
             JOIN reading_logs rl ON rs.reading_log_id = rl.id
             WHERE rs.user_id = ? ${publicOnly}`,
            [userId]
        );

        const logsQuery = db.execute(
            `SELECT
                COALESCE(SUM(CASE
                    WHEN rl.status = 'terminado' AND b.page_count > 0 THEN b.page_count
                    ELSE rl.current_page
                END), 0) AS total_pages,
                COUNT(CASE WHEN rl.status = 'terminado' THEN 1 END) AS finished_books,
                COUNT(CASE WHEN rl.status = 'terminado'
                    AND (YEAR(rl.finish_date) = ? OR (rl.finish_date IS NULL AND YEAR(rl.created_at) = ?))
                    THEN 1 END) AS finished_books_this_year,
                AVG(CASE WHEN rl.rating IS NOT NULL AND rl.rating > 0 THEN rl.rating END) AS avg_rating
             FROM reading_logs rl
             JOIN books b ON b.id = rl.book_id
             WHERE rl.user_id = ? ${publicOnly}`,
            [currentYear, currentYear, userId]
        );

        // Meta anual en su propia query: con LEFT JOIN, un usuario sin lecturas perdía su meta.
        const goalQuery = db.execute(
            'SELECT target_books FROM reading_goals WHERE user_id = ? AND year = ?',
            [userId, currentYear]
        );

        const likesQuery = db.execute(
            `SELECT COUNT(*) AS total_likes
             FROM reading_likes rlk
             JOIN reading_logs rl ON rlk.reading_log_id = rl.id
             WHERE rl.user_id = ? ${publicOnly}`,
            [userId]
        );

        const [[sessionRows], [logsRows], [goalRows], [likesRows]] = await Promise.all([
            sessionQuery,
            logsQuery,
            goalQuery,
            likesQuery,
        ]);
        const logs = logsRows[0];

        return {
            total_minutes: Number(sessionRows[0].total_minutes || 0),
            total_pages: Number(logs.total_pages || 0),
            finished_books: Number(logs.finished_books || 0),
            finished_books_this_year: Number(logs.finished_books_this_year || 0),
            avg_rating: logs.avg_rating ? parseFloat(logs.avg_rating).toFixed(1) : '0.0',
            target_books_this_year: goalRows[0]?.target_books ?? 10,
            total_likes: Number(likesRows[0].total_likes || 0),
            year: currentYear,
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

    // 9. ESTADÍSTICAS DE UN LIBRO ESPECÍFICO (los permisos se comprueban en el servicio)
    static async getStatsByReadingLogId(readingLogId) {
        const [[timeRows], [logRows]] = await Promise.all([
            db.execute(
                `SELECT COALESCE(SUM(duration_minutes), 0) AS total_minutes,
                        COUNT(*) AS total_sessions,
                        COALESCE(AVG(duration_minutes), 0) AS avg_minutes
                 FROM reading_sessions WHERE reading_log_id = ?`,
                [readingLogId]
            ),
            db.execute(
                'SELECT current_page, status, rating, review_text, created_at, finish_date FROM reading_logs WHERE id = ?',
                [readingLogId]
            ),
        ]);

        return {
            total_minutes: Number(timeRows[0].total_minutes || 0),
            total_sessions: Number(timeRows[0].total_sessions || 0),
            avg_session_minutes: Math.round(parseFloat(timeRows[0].avg_minutes || 0)),
            log_info: logRows[0] || null,
        };
    }
}

module.exports = ReadingModel;
