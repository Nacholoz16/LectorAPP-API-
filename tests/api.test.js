const request = require('supertest');
const app = require('../src/app'); // Tendremos que exportar 'app' (ver nota abajo)
const db = require('../src/config/db');

// Mocks (Simulacros)
// No queremos llamar a OpenLibrary real en cada test (sería lento y frágil).
// Simulamos que el utilitario devuelve siempre lo mismo.
jest.mock('../src/utils/openLibrary', () => ({
    searchBooks: jest.fn().mockResolvedValue([
        {
            external_id: '/works/OL_TEST',
            title: 'Libro de Prueba Jest',
            authors: 'Test Author',
            cover_url: null,
            isbn: '1234567890',
            page_count: 100
        }
    ])
}));

// Antes de todos los tests: Limpiar la DB de prueba
beforeAll(async () => {
    // Orden importante: borrar hijos (reading_logs) antes que padres (users/books)
    await db.query('DELETE FROM reading_logs');
    await db.query('DELETE FROM users');
    await db.query('DELETE FROM books');
});

// Al finalizar: Cerrar la conexión para que Jest no se quede colgado
afterAll(async () => {
    await db.end();
});

describe('API E2E Tests', () => {
    let userToken;
    let userId;

    // ----------------------------------------------------
    // TEST DE AUTH
    // ----------------------------------------------------
    test('POST /api/auth/register - Debe registrar un usuario nuevo', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({
                username: 'tester_jest',
                email: 'test@jest.com',
                password: 'password123'
            });

        expect(res.statusCode).toBe(201);
        expect(res.body).toHaveProperty('token');
        expect(res.body.user.username).toBe('tester_jest');
        
        userToken = res.body.token; // Guardamos token para siguientes tests
        userId = res.body.user.id;
    });

    test('POST /api/auth/login - Debe loguear y devolver token', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({
                email: 'test@jest.com',
                password: 'password123'
            });

        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty('token');
    });

    // ----------------------------------------------------
    // TEST DE LIBROS (BÚSQUEDA)
    // ----------------------------------------------------
    test('GET /api/books/search - Debe buscar libros (usando el Mock)', async () => {
        const res = await request(app)
            .get('/api/books/search?q=test')
            .set('Authorization', `Bearer ${userToken}`); // Header Auth

        expect(res.statusCode).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].title).toBe('Libro de Prueba Jest');
    });

    // ----------------------------------------------------
    // TEST DE REGISTRO DE LECTURA (CORE)
    // ----------------------------------------------------
    test('POST /api/readings - Debe guardar un libro y opinión', async () => {
        const payload = {
            bookData: {
                external_id: '/works/OL_TEST',
                title: 'Libro de Prueba Jest',
                authors: 'Test Author',
                isbn: '1234567890',
                page_count: 100
            },
            logData: {
                status: 'terminado',
                rating: 5,
                review_text: 'Excelente test',
                start_date: '2023-01-01',
                finish_date: '2023-01-05',
                is_log_public: true
            }
        };

        const res = await request(app)
            .post('/api/readings')
            .set('Authorization', `Bearer ${userToken}`)
            .send(payload);

        expect(res.statusCode).toBe(201);
        expect(res.body).toHaveProperty('logId');
    });

    // ----------------------------------------------------
    // TEST DE FEED
    // ----------------------------------------------------
    test('GET /api/books/feed - Debe mostrar la opinión pública', async () => {
        const res = await request(app)
            .get('/api/books/feed?external_id=/works/OL_TEST')
            // Nota: El feed podría ser público, pero si pusiste protect en la ruta, envía el token
            .set('Authorization', `Bearer ${userToken}`); 

        expect(res.statusCode).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body[0].review_text).toBe('Excelente test');
        expect(res.body[0].username).toBe('tester_jest');
    });
    
    // ----------------------------------------------------
    // TEST DE PERFIL
    // ----------------------------------------------------
    test('GET /api/users/:username - Debe ver su propio perfil', async () => {
        const res = await request(app)
            .get('/api/users/tester_jest')
            .set('Authorization', `Bearer ${userToken}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.is_own_profile).toBe(true);
        expect(res.body.library).toHaveLength(1);
    });
});