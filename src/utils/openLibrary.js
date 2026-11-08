const axios = require('axios');
const logger = require('./logger');

const OPEN_LIB_SEARCH_URL = 'https://openlibrary.org/search.json';
const COVER_BASE_URL = 'https://covers.openlibrary.org/b/id';
// Sin timeout, una búsqueda podía quedar colgada indefinidamente si Open Library no respondía.
const REQUEST_TIMEOUT_MS = 5000;

const searchBooks = async (query) => {
    try {
        const response = await axios.get(OPEN_LIB_SEARCH_URL, {
            timeout: REQUEST_TIMEOUT_MS,
            params: {
                q: query,
                limit: 10,
                // Solo los campos necesarios para ahorrar ancho de banda
                fields: 'key,title,author_name,cover_i,isbn,number_of_pages_median,first_publish_year',
            },
        });

        if (!response.data.docs) return [];

        return response.data.docs.map((book) => ({
            // La key de Open Library tiene la forma "/works/OL12345W"
            external_id: book.key,
            title: book.title,
            authors: book.author_name ? book.author_name.join(', ') : 'Autor Desconocido',
            cover_url: book.cover_i ? `${COVER_BASE_URL}/${book.cover_i}-M.jpg` : null,
            isbn: book.isbn ? book.isbn[0] : null,
            page_count: book.number_of_pages_median || 0,
            published_year: book.first_publish_year,
        }));
    } catch (error) {
        // Si Open Library falla, la búsqueda sigue funcionando con los resultados locales.
        logger.warn({ err: error.message }, 'Open Library no disponible');
        return [];
    }
};

module.exports = { searchBooks };
