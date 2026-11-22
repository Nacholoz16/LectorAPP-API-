const request = require('supertest');
const { outbox } = require('../src/utils/mailer');
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
        'admin_actions',
        'refresh_tokens',
        'password_resets',
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
                .send({ username: 'tester_jest', email: '  Test@Jest.com ', password: 'password123', accept_terms: true });

            expect(res.statusCode).toBe(201);
            expect(res.body).toHaveProperty('token');
            expect(res.body.user.email).toBe('test@jest.com');
            ownerToken = res.body.token;
        });

        test('register: segundo usuario para pruebas de permisos', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({ username: 'otro_user', email: 'otro@jest.com', password: 'password123', accept_terms: true });
            expect(res.statusCode).toBe(201);
            otherToken = res.body.token;
        });

        test('register: email duplicado → 409', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({ username: 'nuevo_user', email: 'TEST@jest.com', password: 'password123', accept_terms: true });
            expect(res.statusCode).toBe(409);
            expect(res.body.code).toBe('CONFLICT');
        });

        test('register: username con caracteres no permitidos → 400', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({ username: 'bad/name', email: 'bad@jest.com', password: 'password123', accept_terms: true });
            expect(res.statusCode).toBe(400);
            expect(res.body.code).toBe('VALIDATION_ERROR');
        });

        test('register: contraseña corta → 400', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({ username: 'corto_pw', email: 'corto@jest.com', password: '123', accept_terms: true });
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

    describe('CORS', () => {
        test('la web nueva (lector.nacholoz3d.cl) está permitida, también en el preflight', async () => {
            const origin = 'https://lector.nacholoz3d.cl';
            const res = await request(app).get('/api/health').set('Origin', origin);
            expect(res.headers['access-control-allow-origin']).toBe(origin);

            const pre = await request(app)
                .options('/api/auth/login')
                .set('Origin', origin)
                .set('Access-Control-Request-Method', 'POST')
                .set('Access-Control-Request-Headers', 'content-type,authorization');
            expect(pre.statusCode).toBe(204);
            expect(pre.headers['access-control-allow-origin']).toBe(origin);
        });

        test('los orígenes existentes siguen permitidos', async () => {
            const res = await request(app).get('/api/health').set('Origin', 'https://nacholoz3d.cl');
            expect(res.headers['access-control-allow-origin']).toBe('https://nacholoz3d.cl');
        });

        test('un origen desconocido no recibe Access-Control-Allow-Origin', async () => {
            const res = await request(app).get('/api/health').set('Origin', 'https://evil.example.com');
            expect(res.headers['access-control-allow-origin']).toBeUndefined();
        });
    });

    // ------------------------------------------------------------------
    // Va al final: invalida ownerToken al cambiar la contraseña.
    describe('Recuperar contraseña', () => {
        const SAME_MESSAGE = 'Si el email está registrado, te enviamos un código. Revisa también la carpeta de spam.';
        const lastCodeFor = (email) => {
            const mail = [...outbox].reverse().find((m) => m.to === email);
            return mail && mail.text.match(/\b(\d{6})\b/)[1];
        };
        const skipCooldown = () =>
            db.query('UPDATE password_resets SET created_at = created_at - INTERVAL 2 MINUTE');

        test('email no registrado: misma respuesta y no se envía nada', async () => {
            const before = outbox.length;
            const res = await request(app)
                .post('/api/auth/forgot-password')
                .send({ email: 'nadie@jest.com' });
            expect(res.statusCode).toBe(200);
            expect(res.body.message).toBe(SAME_MESSAGE);
            expect(outbox.length).toBe(before);
        });

        test('email registrado: envía un código de 6 dígitos (normaliza mayúsculas)', async () => {
            const res = await request(app)
                .post('/api/auth/forgot-password')
                .send({ email: ' TEST@jest.com ' });
            expect(res.statusCode).toBe(200);
            expect(res.body.message).toBe(SAME_MESSAGE);
            expect(lastCodeFor('test@jest.com')).toMatch(/^\d{6}$/);
        });

        test('no reenvía otro código antes de 60 s', async () => {
            const before = outbox.length;
            await request(app).post('/api/auth/forgot-password').send({ email: 'test@jest.com' });
            expect(outbox.length).toBe(before);
        });

        test('código incorrecto → 400 sin cambiar nada', async () => {
            const code = lastCodeFor('test@jest.com');
            const wrong = code === '000000' ? '111111' : '000000';
            const res = await request(app)
                .post('/api/auth/reset-password')
                .send({ email: 'test@jest.com', code: wrong, password: 'nuevaClave123' });
            expect(res.statusCode).toBe(400);
            expect(res.body.code).toBe('VALIDATION_ERROR');
        });

        test('formato inválido de código o contraseña corta → 400', async () => {
            const res = await request(app)
                .post('/api/auth/reset-password')
                .send({ email: 'test@jest.com', code: '12ab', password: 'corta' });
            expect(res.statusCode).toBe(400);
            expect(res.body.code).toBe('VALIDATION_ERROR');
        });

        test('código correcto: cambia la contraseña, devuelve sesión y cierra las anteriores', async () => {
            const code = lastCodeFor('test@jest.com');
            const res = await request(app)
                .post('/api/auth/reset-password')
                .send({ email: 'test@jest.com', code, password: 'nuevaClave123' });
            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveProperty('token');
            expect(res.body.user.username).toBe('tester_jest');

            // La sesión nueva funciona…
            const fresh = await request(app).get('/api/readings/feed').set(auth(res.body.token));
            expect(fresh.statusCode).toBe(200);
            // …y la anterior (emitida antes del cambio) ya no.
            const old = await request(app).get('/api/readings/feed').set(auth(ownerToken));
            expect(old.statusCode).toBe(401);

            const oldPass = await request(app)
                .post('/api/auth/login')
                .send({ username: 'tester_jest', password: 'password123' });
            expect(oldPass.statusCode).toBe(401);
            const newPass = await request(app)
                .post('/api/auth/login')
                .send({ username: 'tester_jest', password: 'nuevaClave123' });
            expect(newPass.statusCode).toBe(200);
        });

        test('un código ya usado no sirve otra vez', async () => {
            const code = lastCodeFor('test@jest.com');
            const res = await request(app)
                .post('/api/auth/reset-password')
                .send({ email: 'test@jest.com', code, password: 'otraClave456' });
            expect(res.statusCode).toBe(400);
        });

        test('tras 5 intentos fallidos el código queda bloqueado aunque luego se acierte', async () => {
            await skipCooldown();
            await request(app).post('/api/auth/forgot-password').send({ email: 'test@jest.com' });
            const code = lastCodeFor('test@jest.com');
            const wrong = code === '000000' ? '111111' : '000000';
            for (let i = 0; i < 5; i++) {
                await request(app)
                    .post('/api/auth/reset-password')
                    .send({ email: 'test@jest.com', code: wrong, password: 'otraClave456' });
            }
            const res = await request(app)
                .post('/api/auth/reset-password')
                .send({ email: 'test@jest.com', code, password: 'otraClave456' });
            expect(res.statusCode).toBe(400);
        });
    });

    // ------------------------------------------------------------------
    describe('Sesión: refresh tokens', () => {
        const login = (username, password) =>
            request(app).post('/api/auth/login').send({ username, password });
        const refresh = (refresh_token) =>
            request(app).post('/api/auth/refresh').send({ refresh_token });

        test('login entrega token de acceso de 30 min y refresh token', async () => {
            const res = await login('otro_user', 'password123');
            expect(res.statusCode).toBe(200);
            expect(typeof res.body.refresh_token).toBe('string');
            const payload = JSON.parse(
                Buffer.from(res.body.token.split('.')[1], 'base64url').toString()
            );
            expect(payload.exp - payload.iat).toBe(30 * 60);
        });

        test('dos logins seguidos dan tokens distintos (cerrar uno no cierra el otro)', async () => {
            const [a, b] = await Promise.all([
                login('otro_user', 'password123'),
                login('otro_user', 'password123'),
            ]);
            expect(a.body.token).not.toBe(b.body.token);
            await request(app).post('/api/auth/logout').set(auth(a.body.token));
            const still = await request(app).get('/api/readings/feed').set(auth(b.body.token));
            expect(still.statusCode).toBe(200);
        });

                test('refresh rota: entrega tokens nuevos y el acceso nuevo funciona', async () => {
            const first = await login('otro_user', 'password123');
            const res = await refresh(first.body.refresh_token);
            expect(res.statusCode).toBe(200);
            expect(res.body.refresh_token).not.toBe(first.body.refresh_token);
            const feed = await request(app).get('/api/readings/feed').set(auth(res.body.token));
            expect(feed.statusCode).toBe(200);
        });

        test('reutilizar un refresh ya rotado revoca toda la sesión (posible robo)', async () => {
            const first = await login('otro_user', 'password123');
            const second = await refresh(first.body.refresh_token);
            expect(second.statusCode).toBe(200);

            const reuse = await refresh(first.body.refresh_token);
            expect(reuse.statusCode).toBe(401);
            // El refresh legítimo más nuevo también quedó revocado.
            const afterTheft = await refresh(second.body.refresh_token);
            expect(afterTheft.statusCode).toBe(401);
        });

        test('logout solo con refresh token (acceso ya vencido) cierra la sesión', async () => {
            const s = await login('otro_user', 'password123');
            const out = await request(app)
                .post('/api/auth/logout')
                .send({ refresh_token: s.body.refresh_token });
            expect(out.statusCode).toBe(200);
            expect((await refresh(s.body.refresh_token)).statusCode).toBe(401);
        });

        test('refresh token inexistente → 401; con formato inválido → 400', async () => {
            expect((await refresh('x'.repeat(43))).statusCode).toBe(401);
            expect((await refresh('corto')).statusCode).toBe(400);
        });

        test('cambiar la contraseña por recuperación revoca los refresh tokens', async () => {
            const s = await login('tester_jest', 'nuevaClave123');
            expect(s.statusCode).toBe(200);

            await db.query('UPDATE password_resets SET created_at = created_at - INTERVAL 2 MINUTE');
            await request(app).post('/api/auth/forgot-password').send({ email: 'test@jest.com' });
            const mail = [...outbox].reverse().find((m) => m.to === 'test@jest.com');
            const code = mail.text.match(/\b(\d{6})\b/)[1];
            const reset = await request(app)
                .post('/api/auth/reset-password')
                .send({ email: 'test@jest.com', code, password: 'claveFinal789' });
            expect(reset.statusCode).toBe(200);
            expect(typeof reset.body.refresh_token).toBe('string');

            expect((await refresh(s.body.refresh_token)).statusCode).toBe(401);
            expect((await refresh(reset.body.refresh_token)).statusCode).toBe(200);
        });
    });

    // ------------------------------------------------------------------
    describe('Administración (rol y auditoría)', () => {
        let adminToken;
        let adminId;
        let normalToken;
        let normalId;

        const roleOf = async (id) => {
            const [rows] = await db.query('SELECT role FROM users WHERE id = ?', [id]);
            return rows[0].role;
        };

        // Rutas de muestra: existentes o no, GET/POST/DELETE. Para un no-admin, todas deben
        // responder igual (401/403) sin revelar cuáles existen.
        const ADMIN_ROUTES = [
            ['get', '/api/admin'],
            ['get', '/api/admin/users'],
            ['get', '/api/admin/no-existe/de/verdad'],
            ['post', '/api/admin/users/1/suspend'],
            ['post', '/api/admin/reports'],
            ['delete', '/api/admin/readings/1'],
        ];

        beforeAll(async () => {
            const a = await request(app)
                .post('/api/auth/register')
                .send({ username: 'admin_jest', email: 'admin@jest.com', password: 'password123', accept_terms: true });
            adminToken = a.body.token;
            adminId = a.body.user.id;

            const n = await request(app)
                .post('/api/auth/register')
                .send({ username: 'normal_jest', email: 'normal@jest.com', password: 'password123', accept_terms: true });
            normalToken = n.body.token;
            normalId = n.body.user.id;

            // D3: el rol solo se asigna por SQL.
            await db.query("UPDATE users SET role = 'admin' WHERE id = ?", [adminId]);
        });

        test('una cuenta nueva tiene role = user', async () => {
            expect(await roleOf(normalId)).toBe('user');
        });

        test('sin token → 401 en todo /admin/*', async () => {
            for (const [method, url] of ADMIN_ROUTES) {
                const res = await request(app)[method](url).send({});
                expect(res.statusCode).toBe(401);
                expect(res.body.code).toBe('UNAUTHORIZED');
            }
        });

        test('usuario normal → 403 FORBIDDEN en todo /admin/* (exista la ruta o no)', async () => {
            for (const [method, url] of ADMIN_ROUTES) {
                const res = await request(app)[method](url).set(auth(normalToken)).send({ note: 'x' });
                expect(res.statusCode).toBe(403);
                expect(res.body).toEqual({ error: expect.any(String), code: 'FORBIDDEN' });
            }
        });

        test('admin → pasa requireAdmin (ruta inexistente da 404 normal)', async () => {
            for (const [method, url] of ADMIN_ROUTES) {
                const res = await request(app)[method](url).set(auth(adminToken)).send({});
                expect(res.statusCode).toBe(404);
                expect(res.body.code).toBe('NOT_FOUND');
            }
        });

        test('el rol se lee de la BD en cada petición: quitarlo tiene efecto inmediato', async () => {
            await db.query("UPDATE users SET role = 'user' WHERE id = ?", [adminId]);
            const revoked = await request(app).get('/api/admin/users').set(auth(adminToken));
            expect(revoked.statusCode).toBe(403);

            await db.query("UPDATE users SET role = 'admin' WHERE id = ?", [adminId]);
            const restored = await request(app).get('/api/admin/users').set(auth(adminToken));
            expect(restored.statusCode).toBe(404);
        });

        test('el JWT no lleva el rol (no se confía en claims)', async () => {
            const payload = JSON.parse(Buffer.from(adminToken.split('.')[1], 'base64url').toString());
            expect(payload).not.toHaveProperty('role');
        });

        test('registro con role: admin → se ignora, la cuenta queda como user', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({ username: 'colado_jest', email: 'colado@jest.com', password: 'password123', accept_terms: true, role: 'admin' });
            expect(res.statusCode).toBe(201);
            expect(res.body.user).not.toHaveProperty('role');
            expect(await roleOf(res.body.user.id)).toBe('user');
        });

        test('login con role en el body → se ignora', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({ username: 'normal_jest', password: 'password123', accept_terms: true, role: 'admin' });
            expect(res.statusCode).toBe(200);
            expect(await roleOf(normalId)).toBe('user');
        });

        test('PUT /users/privacy con role → 400 y el rol no cambia', async () => {
            const res = await request(app)
                .put('/api/users/privacy')
                .set(auth(normalToken))
                .send({ is_profile_public: true, role: 'admin' });
            expect(res.statusCode).toBe(400);
            expect(res.body.code).toBe('VALIDATION_ERROR');
            expect(await roleOf(normalId)).toBe('user');
        });

        test('POST /users/goal con role → se ignora', async () => {
            const res = await request(app)
                .post('/api/users/goal')
                .set(auth(normalToken))
                .send({ target_books: 5, role: 'admin' });
            expect(res.statusCode).toBe(200);
            expect(await roleOf(normalId)).toBe('user');
        });

        test('el perfil público no expone el rol', async () => {
            const res = await request(app).get('/api/users/admin_jest').set(auth(normalToken));
            expect(res.statusCode).toBe(200);
            expect(res.body).not.toHaveProperty('role');
        });

        test('logAdminAction inserta la fila (quién, qué, a quién, nota recortada)', async () => {
            const { logAdminAction } = require('../src/services/adminAudit.service');
            const id = await logAdminAction({
                adminId,
                action: 'user.suspend',
                targetType: 'user',
                targetId: normalId,
                note: '  spam reiterado  ',
            });
            const [rows] = await db.query('SELECT * FROM admin_actions WHERE id = ?', [id]);
            expect(rows[0]).toMatchObject({
                admin_id: adminId,
                action: 'user.suspend',
                target_type: 'user',
                target_id: normalId,
                note: 'spam reiterado',
            });
            expect(rows[0].created_at).toBeInstanceOf(Date);

            // Nota vacía o ausente → NULL.
            const id2 = await logAdminAction({ adminId, action: 'report.dismiss', targetType: 'report', note: '   ' });
            const [rows2] = await db.query('SELECT note, target_id FROM admin_actions WHERE id = ?', [id2]);
            expect(rows2[0]).toEqual({ note: null, target_id: null });
        });

        test('logAdminAction dentro de una transacción: se revierte o confirma con ella', async () => {
            const { logAdminAction } = require('../src/services/adminAudit.service');
            const count = async () => {
                const [rows] = await db.query("SELECT COUNT(*) AS n FROM admin_actions WHERE action = 'log.hide'");
                return rows[0].n;
            };

            const conn = await db.getConnection();
            try {
                await conn.beginTransaction();
                await logAdminAction({ adminId, action: 'log.hide', targetType: 'reading_log', targetId: 1 }, conn);
                await conn.rollback();
                expect(await count()).toBe(0);

                await conn.beginTransaction();
                await logAdminAction({ adminId, action: 'log.hide', targetType: 'reading_log', targetId: 1 }, conn);
                await conn.commit();
                expect(await count()).toBe(1);
            } finally {
                conn.release();
            }
        });

        test('logAdminAction valida los datos (nota > 500, acción o admin inválidos)', async () => {
            const { logAdminAction } = require('../src/services/adminAudit.service');
            const { ValidationError } = require('../src/utils/errors');
            const base = { adminId, action: 'user.suspend', targetType: 'user', targetId: normalId };

            await expect(logAdminAction({ ...base, note: 'x'.repeat(501) })).rejects.toBeInstanceOf(ValidationError);
            await expect(logAdminAction({ ...base, action: 'DROP TABLE' })).rejects.toBeInstanceOf(ValidationError);
            await expect(logAdminAction({ ...base, adminId: undefined })).rejects.toBeInstanceOf(ValidationError);
            await expect(logAdminAction({ ...base, note: 'x'.repeat(500) })).resolves.toEqual(expect.any(Number));
        });

        test('si se borra la cuenta del admin, la auditoría se conserva (admin_id = NULL)', async () => {
            const tmp = await request(app)
                .post('/api/auth/register')
                .send({ username: 'admin_tmp', email: 'admin_tmp@jest.com', password: 'password123', accept_terms: true });
            const tmpId = tmp.body.user.id;
            const { logAdminAction } = require('../src/services/adminAudit.service');
            const id = await logAdminAction({ adminId: tmpId, action: 'user.warn', targetType: 'user', targetId: normalId });

            await db.query('DELETE FROM refresh_tokens WHERE user_id = ?', [tmpId]);
            await db.query('DELETE FROM users WHERE id = ?', [tmpId]);
            const [rows] = await db.query('SELECT admin_id, action FROM admin_actions WHERE id = ?', [id]);
            expect(rows[0]).toEqual({ admin_id: null, action: 'user.warn' });
        });

        test('rate limit propio de /admin/*: 429 RATE_LIMITED por cuenta', async () => {
            const express = require('express');
            const { createAdminLimiter } = require('../src/api/middlewares/admin.middleware');
            // Mini app con el mismo limitador pero límite 2 (el real se omite en NODE_ENV=test).
            const mini = express();
            mini.use((req, res, next) => {
                req.user = { id: Number(req.get('x-user')) };
                next();
            });
            mini.use(createAdminLimiter({ limit: 2 }));
            mini.get('/x', (req, res) => res.json({ ok: true }));

            expect((await request(mini).get('/x').set('x-user', '1')).statusCode).toBe(200);
            expect((await request(mini).get('/x').set('x-user', '1')).statusCode).toBe(200);
            const limited = await request(mini).get('/x').set('x-user', '1');
            expect(limited.statusCode).toBe(429);
            expect(limited.body.code).toBe('RATE_LIMITED');
            // El límite es por cuenta: otra cuenta no está afectada.
            expect((await request(mini).get('/x').set('x-user', '2')).statusCode).toBe(200);
        });
    });

    // ------------------------------------------------------------------
    describe('Términos: aceptación obligatoria (1.3)', () => {
        const { CURRENT_TERMS_VERSION } = require('../src/config/terms');
        const BOOK_T1 = { external_id: '/works/OLT1W', title: 'Libro Términos 1', page_count: 50 };
        const BOOK_T2 = { external_id: '/works/OLT2W', title: 'Libro Términos 2', page_count: 50 };
        const BOOK_T3 = { external_id: '/works/OLT3W', title: 'Libro Términos 3', page_count: 50 };
        const BOOK_T4 = { external_id: '/works/OLT4W', title: 'Libro Términos 4', page_count: 50 };

        let legacyToken;
        let legacyId;
        let legacyPublicLogId;
        let legacyPrivateLogId;

        const termsRow = async (id) => {
            const [rows] = await db.query('SELECT terms_version, terms_accepted_at FROM users WHERE id = ?', [id]);
            return rows[0];
        };
        const isPublicInDb = async (logId) => {
            const [rows] = await db.query('SELECT is_log_public FROM reading_logs WHERE id = ?', [logId]);
            return rows[0].is_log_public;
        };
        const createLog = (token, bookData, logData) =>
            request(app).post('/api/readings').set(auth(token)).send({ bookData, logData });

        beforeAll(async () => {
            // Cuenta "antigua": registrada antes de la 1.3. Se crea normal (con términos), publica
            // una lectura y luego se borra su aceptación por SQL, como quedan tras la migración.
            const res = await request(app)
                .post('/api/auth/register')
                .send({ username: 'legacy_jest', email: 'legacy@jest.com', password: 'password123', accept_terms: true });
            legacyToken = res.body.token;
            legacyId = res.body.user.id;
            const pub = await createLog(legacyToken, BOOK_T1, { status: 'terminado', review_text: 'Antigua', is_log_public: true });
            legacyPublicLogId = pub.body.logId;
            await db.query('UPDATE users SET terms_version = NULL, terms_accepted_at = NULL WHERE id = ?', [legacyId]);
        });

        test('registro sin accept_terms → 400 VALIDATION_ERROR y no crea la cuenta', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({ username: 'sin_terms', email: 'sin_terms@jest.com', password: 'password123' });
            expect(res.statusCode).toBe(400);
            expect(res.body.code).toBe('VALIDATION_ERROR');
            expect(res.body.error).toMatch(/Términos/);
            const [rows] = await db.query("SELECT 1 FROM users WHERE username = 'sin_terms'");
            expect(rows).toHaveLength(0);
        });

        test('registro con accept_terms false, "true" (string) o 1 → 400', async () => {
            for (const accept_terms of [false, 'true', 1]) {
                const res = await request(app)
                    .post('/api/auth/register')
                    .send({ username: 'sin_terms', email: 'sin_terms@jest.com', password: 'password123', accept_terms });
                expect(res.statusCode).toBe(400);
                expect(res.body.code).toBe('VALIDATION_ERROR');
            }
        });

        test('registro con accept_terms: true guarda versión vigente y fecha', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({ username: 'con_terms', email: 'con_terms@jest.com', password: 'password123', accept_terms: true });
            expect(res.statusCode).toBe(201);
            expect(res.body.user).toMatchObject({
                terms_version: CURRENT_TERMS_VERSION,
                current_terms_version: CURRENT_TERMS_VERSION,
                needs_terms: false,
            });
            const row = await termsRow(res.body.user.id);
            expect(row.terms_version).toBe('2026-11');
            expect(row.terms_accepted_at).toBeInstanceOf(Date);
        });

        test('login de una cuenta sin aceptar → needs_terms: true', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({ username: 'legacy_jest', password: 'password123' });
            expect(res.statusCode).toBe(200);
            expect(res.body.user).toMatchObject({
                terms_version: null,
                current_terms_version: CURRENT_TERMS_VERSION,
                needs_terms: true,
            });
        });

        test('perfil propio expone el estado de los términos; el ajeno no', async () => {
            const own = await request(app).get('/api/users/legacy_jest').set(auth(legacyToken));
            expect(own.body).toMatchObject({
                needs_terms: true,
                terms_version: null,
                current_terms_version: CURRENT_TERMS_VERSION,
            });

            const other = await request(app).get('/api/users/legacy_jest').set(auth(otherToken));
            expect(other.statusCode).toBe(200);
            expect(other.body).not.toHaveProperty('needs_terms');
            expect(other.body).not.toHaveProperty('terms_version');
            expect(other.body).not.toHaveProperty('current_terms_version');
        });

        test('sin aceptar: crear una lectura PÚBLICA → 403 TERMS_REQUIRED y no se guarda', async () => {
            const res = await createLog(legacyToken, BOOK_T2, { status: 'leyendo', is_log_public: true });
            expect(res.statusCode).toBe(403);
            expect(res.body.code).toBe('TERMS_REQUIRED');
            const [rows] = await db.query(
                'SELECT 1 FROM reading_logs rl JOIN books b ON b.id = rl.book_id WHERE rl.user_id = ? AND b.external_id = ?',
                [legacyId, BOOK_T2.external_id]
            );
            expect(rows).toHaveLength(0);
        });

        test('sin aceptar: crear una lectura PRIVADA → 201 (no se bloquea)', async () => {
            const res = await createLog(legacyToken, BOOK_T2, { status: 'leyendo', is_log_public: false });
            expect(res.statusCode).toBe(201);
            legacyPrivateLogId = res.body.logId;
            // Sin is_log_public también es privada por defecto.
            const def = await createLog(legacyToken, BOOK_T3, { status: 'leyendo' });
            expect(def.statusCode).toBe(201);
        });

        test('sin aceptar: editar privada → pública → 403 TERMS_REQUIRED y sigue privada', async () => {
            const res = await request(app)
                .put(`/api/readings/${legacyPrivateLogId}`)
                .set(auth(legacyToken))
                .send({ is_log_public: true });
            expect(res.statusCode).toBe(403);
            expect(res.body.code).toBe('TERMS_REQUIRED');
            expect(await isPublicInDb(legacyPrivateLogId)).toBe(0);
        });

        test('sin aceptar: editar una privada sin publicarla → 200', async () => {
            const res = await request(app)
                .put(`/api/readings/${legacyPrivateLogId}`)
                .set(auth(legacyToken))
                .send({ current_page: 10, review_text: 'Nota privada', is_log_public: false });
            expect(res.statusCode).toBe(200);
        });

        test('las públicas existentes no se tocan; editarlas exige aceptar, hacerlas privadas no', async () => {
            expect(await isPublicInDb(legacyPublicLogId)).toBe(1);
            const feed = await request(app).get(`/api/books/feed?external_id=${BOOK_T1.external_id}`);
            expect(feed.body.map((r) => r.review_text)).toContain('Antigua');

            const edit = await request(app)
                .put(`/api/readings/${legacyPublicLogId}`)
                .set(auth(legacyToken))
                .send({ review_text: 'Texto nuevo público' });
            expect(edit.statusCode).toBe(403);
            expect(edit.body.code).toBe('TERMS_REQUIRED');

            const hide = await request(app)
                .put(`/api/readings/${legacyPublicLogId}`)
                .set(auth(legacyToken))
                .send({ is_log_public: false });
            expect(hide.statusCode).toBe(200);
            expect(await isPublicInDb(legacyPublicLogId)).toBe(0);
        });

        test('TERMS_REQUIRED no se adelanta a la autorización: lectura ajena → 403 FORBIDDEN', async () => {
            const res = await request(app)
                .put(`/api/readings/${publicLogId}`)
                .set(auth(legacyToken))
                .send({ is_log_public: true });
            expect(res.statusCode).toBe(403);
            expect(res.body.code).toBe('FORBIDDEN');
        });

        test('POST /account/terms sin token → 401', async () => {
            const res = await request(app).post('/api/account/terms');
            expect(res.statusCode).toBe(401);
            expect(res.body.code).toBe('UNAUTHORIZED');
        });

        test('POST /account/terms acepta la versión vigente y registra la fecha', async () => {
            const res = await request(app).post('/api/account/terms').set(auth(legacyToken)).send({});
            expect(res.statusCode).toBe(200);
            expect(res.body).toMatchObject({
                terms_version: CURRENT_TERMS_VERSION,
                current_terms_version: CURRENT_TERMS_VERSION,
                needs_terms: false,
            });
            expect(res.body.terms_accepted_at).toBeTruthy();
            const row = await termsRow(legacyId);
            expect(row.terms_version).toBe(CURRENT_TERMS_VERSION);
            expect(row.terms_accepted_at).toBeInstanceOf(Date);
        });

        test('POST /account/terms es idempotente: conserva la fecha de la primera aceptación', async () => {
            await db.query("UPDATE users SET terms_accepted_at = '2026-11-01 10:00:00' WHERE id = ?", [legacyId]);
            const before = (await termsRow(legacyId)).terms_accepted_at.getTime();
            const res = await request(app).post('/api/account/terms').set(auth(legacyToken));
            expect(res.statusCode).toBe(200);
            expect((await termsRow(legacyId)).terms_accepted_at.getTime()).toBe(before);
        });

        test('POST /account/terms ignora una versión enviada por el cliente', async () => {
            const res = await request(app)
                .post('/api/account/terms')
                .set(auth(legacyToken))
                .send({ version: '1999-01' });
            expect(res.statusCode).toBe(200);
            expect((await termsRow(legacyId)).terms_version).toBe(CURRENT_TERMS_VERSION);
        });

        test('tras aceptar: publicar una privada y crear una pública → OK', async () => {
            const edit = await request(app)
                .put(`/api/readings/${legacyPrivateLogId}`)
                .set(auth(legacyToken))
                .send({ is_log_public: true });
            expect(edit.statusCode).toBe(200);
            expect(await isPublicInDb(legacyPrivateLogId)).toBe(1);

            const create = await createLog(legacyToken, BOOK_T4, { status: 'leyendo', is_log_public: true });
            expect(create.statusCode).toBe(201);

            const profile = await request(app).get('/api/users/legacy_jest').set(auth(legacyToken));
            expect(profile.body.needs_terms).toBe(false);
        });

        test('versión aceptada desactualizada → needs_terms y vuelve a exigir aceptar', async () => {
            await db.query("UPDATE users SET terms_version = '2025-01' WHERE id = ?", [legacyId]);
            const login = await request(app)
                .post('/api/auth/login')
                .send({ username: 'legacy_jest', password: 'password123' });
            expect(login.body.user).toMatchObject({ terms_version: '2025-01', needs_terms: true });

            const res = await request(app)
                .put(`/api/readings/${legacyPrivateLogId}`)
                .set(auth(legacyToken))
                .send({ review_text: 'Cambio' });
            expect(res.statusCode).toBe(403);
            expect(res.body.code).toBe('TERMS_REQUIRED');

            const accept = await request(app).post('/api/account/terms').set(auth(legacyToken));
            expect(accept.body.terms_version).toBe(CURRENT_TERMS_VERSION);
        });
    });
});
