const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');

// No llamamos a Open Library real en los tests (lento y frágil).
jest.mock('../src/utils/openLibrary', () => ({
    searchBooks: jest.fn().mockResolvedValue([
        {
            external_id: '/works/OL1W',
            title: 'Libro de Prueba Jest',
            authors: 'Test Author',
            cover_url: null,
            isbn: '1234567890',
            page_count: 100,
        },
    ]),
}));

const auth = (token) => ({ Authorization: `Bearer ${token}` });

const BOOK_1 = {
    external_id: '/works/OL1W',
    title: 'Libro de Prueba Jest',
    authors: 'Test Author',
    cover_url: 'https://covers.openlibrary.org/b/id/1-M.jpg',
    isbn: '1234567890',
    page_count: 100,
};

const BOOK_2 = { external_id: '/works/OL2W', title: 'Libro Privado', authors: 'Otro Autor', page_count: 200 };

beforeAll(async () => {
    // La BD de test no tiene FKs: limpiar todas las tablas explícitamente.
    for (const table of [
        'token_blacklist',
        'reading_likes',
        'reading_sessions',
        'reading_goals',
        'reading_logs',
        'users',
        'books',
    ]) {
        await db.query(`DELETE FROM ${table}`);
    }
});

afterAll(async () => {
    await db.end();
});

describe('API E2E', () => {
    let ownerToken;
    let otherToken;
    let publicLogId;
    let privateLogId;

    // ------------------------------------------------------------------
    describe('Auth', () => {
        test('register: crea usuario y normaliza el email a minúsculas', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({ username: 'tester_jest', email: '  Test@Jest.com ', password: 'password123' });

            expect(res.statusCode).toBe(201);
            expect(res.body).toHaveProperty('token');
            expect(res.body.user.email).toBe('test@jest.com');
            ownerToken = res.body.token;
        });

        test('register: segundo usuario para pruebas de permisos', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({ username: 'otro_user', email: 'otro@jest.com', password: 'password123' });
            expect(res.statusCode).toBe(201);
            otherToken = res.body.token;
        });

        test('register: email duplicado → 409', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({ username: 'nuevo_user', email: 'TEST@jest.com', password: 'password123' });
            expect(res.statusCode).toBe(409);
            expect(res.body.code).toBe('CONFLICT');
        });

        test('register: username con caracteres no permitidos → 400', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({ username: 'bad/name', email: 'bad@jest.com', password: 'password123' });
            expect(res.statusCode).toBe(400);
            expect(res.body.code).toBe('VALIDATION_ERROR');
        });

        test('register: contraseña corta → 400', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({ username: 'corto_pw', email: 'corto@jest.com', password: '123' });
            expect(res.statusCode).toBe(400);
        });

        test('login: con email (mayúsculas) → 200', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({ email: 'TEST@JEST.COM', password: 'password123' });
            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveProperty('token');
        });

        test('login: con username → 200', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({ username: 'tester_jest', password: 'password123' });
            expect(res.statusCode).toBe(200);
        });

        test('login: contraseña incorrecta → 401', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({ email: 'test@jest.com', password: 'incorrecta' });
            expect(res.statusCode).toBe(401);
            expect(res.body.error).toBe('Credenciales inválidas');
        });

        test('login: usuario inexistente → 401 (mismo mensaje)', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({ email: 'nadie@jest.com', password: 'password123' });
            expect(res.statusCode).toBe(401);
            expect(res.body.error).toBe('Credenciales inválidas');
        });

        test('login: body vacío → 400 (antes era 500)', async () => {
            const res = await request(app).post('/api/auth/login').send({});
            expect(res.statusCode).toBe(400);
        });

        test('ruta protegida sin token → 401', async () => {
            const res = await request(app).get('/api/readings/feed');
            expect(res.statusCode).toBe(401);
        });
    });

    // ------------------------------------------------------------------
    describe('Libros', () => {
        test('search: usa el mock de Open Library', async () => {
            const res = await request(app).get('/api/books/search?q=test').set(auth(ownerToken));
            expect(res.statusCode).toBe(200);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0].title).toBe('Libro de Prueba Jest');
        });

        test('search: sin q → 400', async () => {
            const res = await request(app).get('/api/books/search').set(auth(ownerToken));
            expect(res.statusCode).toBe(400);
        });
    });

    // ------------------------------------------------------------------
    describe('Lecturas', () => {
        const validLog = {
            status: 'terminado',
            rating: 5,
            review_text: 'Excelente test',
            start_date: '2023-01-01',
            finish_date: '2023-01-05',
            is_log_public: true,
        };

        test('create: guarda libro y opinión → 201', async () => {
            const res = await request(app)
                .post('/api/readings')
                .set(auth(ownerToken))
                .send({ bookData: BOOK_1, logData: validLog });
            expect(res.statusCode).toBe(201);
            expect(res.body).toHaveProperty('logId');
            publicLogId = res.body.logId;
        });

        test('create: mismo libro dos veces → 409', async () => {
            const res = await request(app)
                .post('/api/readings')
                .set(auth(ownerToken))
                .send({ bookData: BOOK_1, logData: validLog });
            expect(res.statusCode).toBe(409);
        });

        test('create: lectura privada en otro libro → 201', async () => {
            const res = await request(app)
                .post('/api/readings')
                .set(auth(ownerToken))
                .send({ bookData: BOOK_2, logData: { status: 'leyendo', is_log_public: false } });
            expect(res.statusCode).toBe(201);
            privateLogId = res.body.logId;
        });

        test('create: portada de un host no permitido → 400', async () => {
            const res = await request(app)
                .post('/api/readings')
                .set(auth(ownerToken))
                .send({
                    bookData: { ...BOOK_1, external_id: '/works/OL3W', cover_url: 'https://evil.example/x.jpg' },
                    logData: validLog,
                });
            expect(res.statusCode).toBe(400);
        });

        test('create: estado inválido → 400', async () => {
            const res = await request(app)
                .post('/api/readings')
                .set(auth(ownerToken))
                .send({ bookData: { ...BOOK_1, external_id: '/works/OL4W' }, logData: { status: 'otro' } });
            expect(res.statusCode).toBe(400);
        });

        test('create: fecha de término anterior a la de inicio → 400', async () => {
            const res = await request(app)
                .post('/api/readings')
                .set(auth(ownerToken))
                .send({
                    bookData: { ...BOOK_1, external_id: '/works/OL5W' },
                    logData: { ...validLog, start_date: '2023-02-10', finish_date: '2023-02-01' },
                });
            expect(res.statusCode).toBe(400);
        });

        test('books/feed: muestra solo la opinión pública', async () => {
            const res = await request(app).get('/api/books/feed?external_id=/works/OL1W');
            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveLength(1);
            expect(res.body[0].review_text).toBe('Excelente test');
            expect(res.body[0].username).toBe('tester_jest');
        });

        test('feed global: limit excesivo → 400', async () => {
            const res = await request(app).get('/api/readings/feed?limit=999999').set(auth(ownerToken));
            expect(res.statusCode).toBe(400);
        });

        test('feed global: before_id no numérico → 400', async () => {
            const res = await request(app).get('/api/readings/feed?before_id=abc').set(auth(ownerToken));
            expect(res.statusCode).toBe(400);
        });

        test('feed global: solo públicas y has_liked booleano', async () => {
            const res = await request(app).get('/api/readings/feed').set(auth(ownerToken));
            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveLength(1);
            expect(typeof res.body[0].has_liked).toBe('boolean');
            expect(typeof res.body[0].likes_count).toBe('number');
        });

        test('feed global por cursor: before_id excluye lo ya visto', async () => {
            const res = await request(app)
                .get(`/api/readings/feed?before_id=${publicLogId}`)
                .set(auth(ownerToken));
            expect(res.statusCode).toBe(200);
            expect(res.body.find((l) => l.id === publicLogId)).toBeUndefined();
        });

        test('feed/new-count: cuenta publicaciones más nuevas que after_id', async () => {
            const all = await request(app).get('/api/readings/feed/new-count?after_id=0').set(auth(ownerToken));
            expect(all.statusCode).toBe(200);
            expect(all.body).toEqual({ count: 1 });

            const none = await request(app)
                .get(`/api/readings/feed/new-count?after_id=${publicLogId}`)
                .set(auth(ownerToken));
            expect(none.body).toEqual({ count: 0 });

            const bad = await request(app).get('/api/readings/feed/new-count').set(auth(ownerToken));
            expect(bad.statusCode).toBe(400);
        });

        test('update parcial: cambia rating sin borrar la reseña', async () => {
            const res = await request(app)
                .put(`/api/readings/${publicLogId}`)
                .set(auth(ownerToken))
                .send({ rating: 4 });
            expect(res.statusCode).toBe(200);

            const lib = await request(app).get('/api/readings/my-library').set(auth(ownerToken));
            const log = lib.body.find((l) => l.id === publicLogId);
            expect(log.rating).toBe(4);
            expect(log.review_text).toBe('Excelente test');
            expect(log.status).toBe('terminado');
        });

        test('update: lectura de otro usuario → 403', async () => {
            const res = await request(app)
                .put(`/api/readings/${publicLogId}`)
                .set(auth(otherToken))
                .send({ rating: 1 });
            expect(res.statusCode).toBe(403);
        });

        test('update: lectura inexistente → 404', async () => {
            const res = await request(app)
                .put('/api/readings/999999')
                .set(auth(ownerToken))
                .send({ rating: 1 });
            expect(res.statusCode).toBe(404);
        });

        test('update: id no numérico → 400', async () => {
            const res = await request(app)
                .put('/api/readings/abc')
                .set(auth(ownerToken))
                .send({ rating: 1 });
            expect(res.statusCode).toBe(400);
        });

        test('like: alterna y devuelve el conteo', async () => {
            const on = await request(app).post(`/api/readings/${publicLogId}/like`).set(auth(otherToken));
            expect(on.statusCode).toBe(200);
            expect(on.body).toEqual({ liked: true, likes_count: 1 });

            const off = await request(app).post(`/api/readings/${publicLogId}/like`).set(auth(otherToken));
            expect(off.body).toEqual({ liked: false, likes_count: 0 });
        });

        test('like: lectura privada de otro usuario → 403', async () => {
            const res = await request(app).post(`/api/readings/${privateLogId}/like`).set(auth(otherToken));
            expect(res.statusCode).toBe(403);
        });

        test('session: el dueño registra tiempo y avanza la página', async () => {
            const res = await request(app)
                .post(`/api/readings/${privateLogId}/session`)
                .set(auth(ownerToken))
                .send({ duration_minutes: 10, pages_read: 5, current_page: 30 });
            expect(res.statusCode).toBe(200);

            const stats = await request(app).get(`/api/readings/${privateLogId}/stats`).set(auth(ownerToken));
            expect(stats.body.total_minutes).toBe(10);
            expect(stats.body.log_info.current_page).toBe(30);
        });

        test('session: duración 0 → 400', async () => {
            const res = await request(app)
                .post(`/api/readings/${privateLogId}/session`)
                .set(auth(ownerToken))
                .send({ duration_minutes: 0, pages_read: 0 });
            expect(res.statusCode).toBe(400);
        });

        test('session: en lectura ajena → 403', async () => {
            const res = await request(app)
                .post(`/api/readings/${publicLogId}/session`)
                .set(auth(otherToken))
                .send({ duration_minutes: 5, pages_read: 1 });
            expect(res.statusCode).toBe(403);
        });

        test('stats de libro: lectura privada ajena → 403', async () => {
            const res = await request(app).get(`/api/readings/${privateLogId}/stats`).set(auth(otherToken));
            expect(res.statusCode).toBe(403);
        });
    });

    // ------------------------------------------------------------------
    describe('Usuarios', () => {
        test('perfil propio: ve todas sus lecturas', async () => {
            const res = await request(app).get('/api/users/tester_jest').set(auth(ownerToken));
            expect(res.statusCode).toBe(200);
            expect(res.body.is_own_profile).toBe(true);
            expect(res.body.library).toHaveLength(2);
        });

        test('perfil ajeno: solo lecturas públicas', async () => {
            const res = await request(app).get('/api/users/tester_jest').set(auth(otherToken));
            expect(res.statusCode).toBe(200);
            expect(res.body.is_own_profile).toBe(false);
            expect(res.body.is_private_lock).toBe(false);
            expect(res.body.library).toHaveLength(1);
        });

        test('username inválido → 400; inexistente → 404', async () => {
            const bad = await request(app).get('/api/users/a').set(auth(ownerToken));
            expect(bad.statusCode).toBe(400);
            const missing = await request(app).get('/api/users/nadie_existe').set(auth(ownerToken));
            expect(missing.statusCode).toBe(404);
        });

        test('privacy: campos desconocidos → 400', async () => {
            const res = await request(app).put('/api/users/privacy').set(auth(ownerToken)).send({ foo: 1 });
            expect(res.statusCode).toBe(400);
        });

        test('privacy: ocultar estadísticas a otros usuarios', async () => {
            const res = await request(app)
                .put('/api/users/privacy')
                .set(auth(ownerToken))
                .send({ are_stats_public: false });
            expect(res.statusCode).toBe(200);

            const stats = await request(app).get('/api/users/tester_jest/stats').set(auth(otherToken));
            expect(stats.body).toEqual({ is_private: true });
        });

        test('goal: meta inválida → 400; válida se refleja en stats', async () => {
            const bad = await request(app).post('/api/users/goal').set(auth(ownerToken)).send({ target_books: 0 });
            expect(bad.statusCode).toBe(400);

            const ok = await request(app).post('/api/users/goal').set(auth(ownerToken)).send({ target_books: 12 });
            expect(ok.statusCode).toBe(200);

            const stats = await request(app).get('/api/users/tester_jest/stats').set(auth(ownerToken));
            expect(stats.body.target_books_this_year).toBe(12);
            expect(stats.body.total_minutes).toBe(10);
            expect(stats.body.finished_books).toBe(1);
            // Terminado (page_count 100) + en curso en la página 30
            expect(stats.body.total_pages).toBe(130);
        });
    });

    // ------------------------------------------------------------------
    describe('Logout y errores generales', () => {
        test('logout revoca el token', async () => {
            const login = await request(app)
                .post('/api/auth/login')
                .send({ username: 'otro_user', password: 'password123' });
            const token = login.body.token;

            const out = await request(app).post('/api/auth/logout').set(auth(token));
            expect(out.statusCode).toBe(200);

            const after = await request(app).get('/api/readings/feed').set(auth(token));
            expect(after.statusCode).toBe(401);
            expect(after.body.error).toBe('Token revocado');
        });

        test('logout sin token → 401', async () => {
            const res = await request(app).post('/api/auth/logout');
            expect(res.statusCode).toBe(401);
        });

        test('JSON malformado → 400', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .set('Content-Type', 'application/json')
                .send('{"email": ');
            expect(res.statusCode).toBe(400);
            expect(res.body.code).toBe('INVALID_JSON');
        });

        test('ruta inexistente → 404 JSON', async () => {
            const res = await request(app).get('/api/no-existe');
            expect(res.statusCode).toBe(404);
            expect(res.body.code).toBe('NOT_FOUND');
        });
    });
});
