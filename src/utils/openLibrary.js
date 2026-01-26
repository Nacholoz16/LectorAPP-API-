const axios = require('axios');

const OPEN_LIB_SEARCH_URL = 'https://openlibrary.org/search.json';
const COVER_BASE_URL = 'https://covers.openlibrary.org/b/id';

const searchBooks = async (query) => {
    try {
        const response = await axios.get(OPEN_LIB_SEARCH_URL, {
            params: {
                q: query,
                limit: 10, // Traemos 10 resultados
                fields: 'key,title,author_name,cover_i,isbn,number_of_pages_median,first_publish_year' // Pedimos solo lo necesario para ahorrar ancho de banda
            }
        });

        if (!response.data.docs) return [];

        return response.data.docs.map(book => {
            // Open Library devuelve arrays para casi todo (autores, isbns)
            const author = book.author_name ? book.author_name.join(', ') : 'Autor Desconocido';
            const isbn = book.isbn ? book.isbn[0] : null;
            
            // Construimos la URL de la portada si existe el ID
            const coverUrl = book.cover_i 
                ? `${COVER_BASE_URL}/${book.cover_i}-M.jpg` 
                : null;

            return {
                // El 'key' de Open Library suele ser "/works/OL12345W", lo limpiamos o guardamos tal cual
                external_id: book.key, 
                title: book.title,
                authors: author,
                cover_url: coverUrl,
                isbn: isbn,
                page_count: book.number_of_pages_median || 0,
                published_year: book.first_publish_year
            };
        });
    } catch (error) {
        console.error('Error fetching Open Library:', error.message);
        return [];
    }
};

module.exports = { searchBooks };