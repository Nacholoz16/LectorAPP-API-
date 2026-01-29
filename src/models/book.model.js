const db = require('../config/db');

class BookModel {
    // Buscar libros en local (MySQL)
    static async searchLocal(query) {
        const searchTerm = `%${query}%`;
        const [rows] = await db.execute(
            'SELECT * FROM books WHERE title LIKE ? OR author LIKE ? LIMIT 10',
            [searchTerm, searchTerm]
        );
        return rows;
    }

    // Guardar un libro nuevo (Caché)
    static async create(bookData) {
        // 1. Verificamos si ya existe por external_id
        const [exists] = await db.execute('SELECT id FROM books WHERE external_id = ?', [bookData.external_id]);
        if (exists.length > 0) return exists[0].id;

        // 2. Si no existe, lo insertamos (INCLUYENDO AÑO)
        const [result] = await db.execute(
            `INSERT INTO books (external_id, isbn, title, author, cover_url, page_count, published_year) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                bookData.external_id, 
                bookData.isbn || null,
                bookData.title,
                bookData.authors || 'Desconocido', // Guardamos "authors" estandarizado
                bookData.cover_url || null, 
                bookData.page_count || null,
                bookData.published_year || null // <--- ¡DATO NUEVO!
            ]
        );
        return result.insertId;
    }

    static async findByExternalId(externalId) {
        const [rows] = await db.execute('SELECT * FROM books WHERE external_id = ?', [externalId]);
        return rows[0];
    }
    
    // Método auxiliar útil para validaciones
    static async findById(id) {
        const [rows] = await db.execute('SELECT * FROM books WHERE id = ?', [id]);
        return rows[0];
    }
}

module.exports = BookModel;