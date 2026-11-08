const db = require('../config/db');
const { isDuplicateEntry } = require('../utils/errors');

class BookModel {
    // Buscar libros en la caché local (MySQL)
    static async searchLocal(query) {
        const searchTerm = `%${query}%`;
        const [rows] = await db.execute(
            'SELECT * FROM books WHERE title LIKE ? OR author LIKE ? LIMIT 10',
            [searchTerm, searchTerm]
        );
        return rows;
    }

    /**
     * Devuelve el id del libro con ese external_id, creándolo si no existe.
     * Los metadatos de un libro ya cacheado NUNCA se sobrescriben con datos del cliente.
     * `bookData` llega validado (cover_url solo de hosts permitidos, longitudes acotadas).
     */
    static async findOrCreate(bookData, conn = db) {
        const [existing] = await conn.execute(
            'SELECT id FROM books WHERE external_id = ?',
            [bookData.external_id]
        );
        if (existing.length > 0) return existing[0].id;

        try {
            const [result] = await conn.execute(
                `INSERT INTO books (external_id, isbn, title, author, cover_url, page_count, published_year)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    bookData.external_id,
                    bookData.isbn || null,
                    bookData.title,
                    bookData.authors || 'Desconocido',
                    bookData.cover_url || null,
                    bookData.page_count || null,
                    bookData.published_year || null,
                ]
            );
            return result.insertId;
        } catch (error) {
            // Otro usuario lo insertó al mismo tiempo (UNIQUE external_id): usar ese.
            if (isDuplicateEntry(error)) {
                const [rows] = await conn.execute(
                    'SELECT id FROM books WHERE external_id = ?',
                    [bookData.external_id]
                );
                return rows[0].id;
            }
            throw error;
        }
    }

    static async findByExternalId(externalId) {
        const [rows] = await db.execute('SELECT * FROM books WHERE external_id = ?', [externalId]);
        return rows[0];
    }

    static async findById(id) {
        const [rows] = await db.execute('SELECT * FROM books WHERE id = ?', [id]);
        return rows[0];
    }
}

module.exports = BookModel;
