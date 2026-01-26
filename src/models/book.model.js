const db = require('../config/db');

class BookModel {
    // Buscar libros en local por título (búsqueda simple)
    static async searchLocal(query) {
        const searchTerm = `%${query}%`;
        const [rows] = await db.execute(
            'SELECT * FROM books WHERE title LIKE ? OR author LIKE ? LIMIT 5',
            [searchTerm, searchTerm]
        );
        return rows;
    }

    // Guardar un libro nuevo (caché)
    // src/models/book.model.js
    static async create(bookData) {
        // Verificar por external_id
        const [exists] = await db.execute('SELECT id FROM books WHERE external_id = ?', [bookData.external_id]);

        if (exists.length > 0) return exists[0].id;

        const [result] = await db.execute(
            `INSERT INTO books (external_id, isbn, title, author, cover_url, page_count) 
         VALUES (?, ?, ?, ?, ?, ?)`,
            [
                bookData.external_id, 
                bookData.isbn || null,
                bookData.title,
                bookData.authors || 'Desconocido',
                bookData.cover_url || null, 
                bookData.page_count
            ]
        );
        return result.insertId;
    }

    static async findByExternalId(externalId) {
        const [rows] = await db.execute(
            'SELECT * FROM books WHERE external_id = ?',
            [externalId]
        );
        return rows[0];
    }

}

module.exports = BookModel;