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

    // ------------------------------------------------------------------
    describe('Desactivar y reactivar la cuenta (2.1)', () => {
        const BOOK_D1 = { external_id: '/works/OLD1W', title: 'Libro Desactivar 1', page_count: 80 };
        const BOOK_D2 = { external_id: '/works/OLD2W', title: 'Libro Desactivar 2', page_count: 80 };
        const BOOK_D3 = { external_id: '/works/OLD3W', title: 'Libro Desactivar 3', page_count: 80 };
        const BOOK_D4 = { external_id: '/works/OLD4W', title: 'Libro Desactivar 4', page_count: 80 };
        const BOOK_V1 = { external_id: '/works/OLV1W', title: 'Libro del Visitante', page_count: 80 };
        const PASSWORD = 'password123';

        let dToken; // cuenta que se desactiva
        let dRefresh;
        let dId;
        let vToken; // otra cuenta (visitante)
        let pubA; // pública
        let privB; // privada
        let pubC; // pública (luego la bloquea la moderación mientras está desactivada)
        let vLog; // lectura pública del visitante, con "me gusta" de la cuenta desactivada

        const createLog = (token, bookData, logData) =>
            request(app).post('/api/readings').set(auth(token)).send({ bookData, logData });
        const visibility = async () => {
            const [rows] = await db.query(
                'SELECT id, is_log_public, public_before_deactivation FROM reading_logs WHERE user_id = ? ORDER BY id',
                [dId]
            );
            return Object.fromEntries(
                rows.map((r) => [r.id, [r.is_log_public, r.public_before_deactivation]])
            );
        };
        const userRow = async () => {
            const [rows] = await db.query('SELECT status, status_changed_at FROM users WHERE id = ?', [dId]);
            return rows[0];
        };
        const deactivate = (password = PASSWORD, token = dToken) =>
            request(app).post('/api/account/deactivate').set(auth(token)).send({ password });
        const reactivate = (token = dToken) =>
            request(app).post('/api/account/reactivate').set(auth(token)).send({});
        const likesOf = async (token, logId) => {
            const res = await request(app).get('/api/readings/my-library?limit=50').set(auth(token));
            return res.body.find((r) => r.id === logId).likes_count;
        };
        const expectDeactivated = (res) => {
            expect(res.statusCode).toBe(403);
            expect(res.body.code).toBe('ACCOUNT_DEACTIVATED');
        };

        beforeAll(async () => {
            const d = await request(app)
                .post('/api/auth/register')
                .send({ username: 'deact_jest', email: 'deact@jest.com', password: PASSWORD, accept_terms: true });
            dToken = d.body.token;
            dRefresh = d.body.refresh_token;
            dId = d.body.user.id;
            const v = await request(app)
                .post('/api/auth/register')
                .send({ username: 'visit_jest', email: 'visit@jest.com', password: PASSWORD, accept_terms: true });
            vToken = v.body.token;

            pubA = (await createLog(dToken, BOOK_D1, { status: 'terminado', review_text: 'Reseña A', is_log_public: true })).body.logId;
            privB = (await createLog(dToken, BOOK_D2, { status: 'leyendo', review_text: 'Nota B', is_log_public: false })).body.logId;
            pubC = (await createLog(dToken, BOOK_D3, { status: 'terminado', review_text: 'Reseña C', is_log_public: true })).body.logId;
            vLog = (await createLog(vToken, BOOK_V1, { status: 'terminado', review_text: 'Reseña V', is_log_public: true })).body.logId;

            await request(app).post(`/api/readings/${vLog}/like`).set(auth(dToken));
            await request(app).post(`/api/readings/${pubA}/like`).set(auth(vToken));
            await request(app).post(`/api/readings/${pubA}/session`).set(auth(dToken))
                .send({ duration_minutes: 20, pages_read: 10 });
        });

        test('registro, login y perfil propio informan status: active (el perfil ajeno no)', async () => {
            const login = await request(app).post('/api/auth/login').send({ username: 'deact_jest', password: PASSWORD });
            expect(login.body.user.status).toBe('active');
            const own = await request(app).get('/api/users/deact_jest').set(auth(dToken));
            expect(own.body.status).toBe('active');
            const other = await request(app).get('/api/users/deact_jest').set(auth(vToken));
            expect(other.body).not.toHaveProperty('status');
        });

        test('GET /account/status (activa) cuenta las lecturas públicas', async () => {
            const res = await request(app).get('/api/account/status').set(auth(dToken));
            expect(res.statusCode).toBe(200);
            expect(res.body).toMatchObject({ status: 'active', public_readings: 2, restorable_readings: 0 });
        });

        test('sin token → 401 en status, deactivate y reactivate', async () => {
            for (const [method, path] of [
                ['get', '/api/account/status'],
                ['post', '/api/account/deactivate'],
                ['post', '/api/account/reactivate'],
            ]) {
                const res = await request(app)[method](path).send({ password: PASSWORD });
                expect(res.statusCode).toBe(401);
                expect(res.body.code).toBe('UNAUTHORIZED');
            }
        });

        test('desactivar sin contraseña → 400', async () => {
            const res = await request(app).post('/api/account/deactivate').set(auth(dToken)).send({});
            expect(res.statusCode).toBe(400);
            expect(res.body.code).toBe('VALIDATION_ERROR');
        });

        test('contraseña incorrecta → 401 INVALID_PASSWORD y nada cambia', async () => {
            const before = await visibility();
            const res = await deactivate('incorrecta');
            expect(res.statusCode).toBe(401);
            expect(res.body.code).toBe('INVALID_PASSWORD');
            expect(await visibility()).toEqual(before);
            expect((await userRow()).status).toBe('active');
            // La sesión sigue sirviendo (no se revocó nada).
            const feed = await request(app).get('/api/readings/feed').set(auth(dToken));
            expect(feed.statusCode).toBe(200);
        });

        test('desactivar: guarda la visibilidad de cada lectura y las deja todas privadas', async () => {
            const res = await deactivate();
            expect(res.statusCode).toBe(200);
            expect(res.body).toEqual({ status: 'deactivated', hidden_readings: 2 });

            expect(await visibility()).toEqual({
                [pubA]: [0, 1],
                [privB]: [0, 0],
                [pubC]: [0, 1],
            });
            const row = await userRow();
            expect(row.status).toBe('deactivated');
            expect(row.status_changed_at).toBeInstanceOf(Date);
        });

        test('desactivar dos veces → 409 y NO pierde la visibilidad guardada', async () => {
            const res = await deactivate();
            expect(res.statusCode).toBe(409);
            expect(res.body.code).toBe('CONFLICT');
            expect(await visibility()).toEqual({
                [pubA]: [0, 1],
                [privB]: [0, 0],
                [pubC]: [0, 1],
            });
        });

        test('GET /account/status (desactivada) cuenta las que volverán a ser públicas', async () => {
            const res = await request(app).get('/api/account/status').set(auth(dToken));
            expect(res.statusCode).toBe(200);
            expect(res.body).toMatchObject({ status: 'deactivated', public_readings: 0, restorable_readings: 2 });
        });

        test('cada acción prohibida → 403 ACCOUNT_DEACTIVATED y no cambia nada', async () => {
            const calls = [
                request(app).post('/api/readings').set(auth(dToken))
                    .send({ bookData: BOOK_D4, logData: { status: 'leyendo' } }),
                request(app).put(`/api/readings/${privB}`).set(auth(dToken)).send({ current_page: 5 }),
                request(app).put(`/api/readings/${pubA}`).set(auth(dToken)).send({ is_log_public: true }),
                request(app).delete(`/api/readings/${privB}`).set(auth(dToken)),
                request(app).post(`/api/readings/${vLog}/like`).set(auth(dToken)),
                request(app).post(`/api/readings/${pubA}/session`).set(auth(dToken))
                    .send({ duration_minutes: 5, pages_read: 1 }),
                request(app).get('/api/books/search?q=test').set(auth(dToken)),
                request(app).get('/api/readings/feed').set(auth(dToken)),
                request(app).get('/api/readings/feed/new-count?after_id=1').set(auth(dToken)),
                request(app).get('/api/users/visit_jest').set(auth(dToken)),
                request(app).get('/api/users/visit_jest/library').set(auth(dToken)),
                request(app).get('/api/users/visit_jest/stats').set(auth(dToken)),
                request(app).get('/api/users/deact_jest').set(auth(dToken)),
                request(app).post('/api/users/goal').set(auth(dToken)).send({ target_books: 5 }),
                request(app).put('/api/users/privacy').set(auth(dToken)).send({ is_profile_public: false }),
                request(app).post('/api/account/terms').set(auth(dToken)),
                // Estadísticas de una lectura AJENA (aunque sea pública): fuera de su biblioteca.
                request(app).get(`/api/readings/${vLog}/stats`).set(auth(dToken)),
                // Administración: tampoco (y no revela si el endpoint existe).
                request(app).get('/api/admin/cualquier-cosa').set(auth(dToken)),
            ];
            for (const res of await Promise.all(calls)) expectDeactivated(res);

            expect(await visibility()).toEqual({
                [pubA]: [0, 1],
                [privB]: [0, 0],
                [pubC]: [0, 1],
            });
            const [sessions] = await db.query('SELECT COUNT(*) AS n FROM reading_sessions WHERE user_id = ?', [dId]);
            expect(sessions[0].n).toBe(1);
            const [likes] = await db.query('SELECT COUNT(*) AS n FROM reading_likes WHERE user_id = ?', [dId]);
            expect(likes[0].n).toBe(1); // su "me gusta" no se borró
        });

        test('lo permitido sigue funcionando: biblioteca, stats de sus libros, login y refresh', async () => {
            const lib = await request(app).get('/api/readings/my-library?limit=50').set(auth(dToken));
            expect(lib.statusCode).toBe(200);
            expect(lib.body.map((r) => r.id).sort()).toEqual([pubA, privB, pubC].sort());

            const stats = await request(app).get(`/api/readings/${pubA}/stats`).set(auth(dToken));
            expect(stats.statusCode).toBe(200);
            expect(stats.body.total_minutes).toBe(20);

            const missing = await request(app).get('/api/readings/999999/stats').set(auth(dToken));
            expect(missing.statusCode).toBe(404);

            const login = await request(app).post('/api/auth/login').send({ username: 'deact_jest', password: PASSWORD });
            expect(login.statusCode).toBe(200);
            expect(login.body.user.status).toBe('deactivated');

            const refreshed = await request(app).post('/api/auth/refresh').send({ refresh_token: dRefresh });
            expect(refreshed.statusCode).toBe(200);
            dToken = refreshed.body.token;
            dRefresh = refreshed.body.refresh_token;
        });

        test('cerrar sesión funciona con la cuenta desactivada', async () => {
            const login = await request(app).post('/api/auth/login').send({ username: 'deact_jest', password: PASSWORD });
            const res = await request(app)
                .post('/api/auth/logout')
                .set(auth(login.body.token))
                .send({ refresh_token: login.body.refresh_token });
            expect(res.statusCode).toBe(200);
            const after = await request(app).get('/api/readings/my-library').set(auth(login.body.token));
            expect(after.statusCode).toBe(401);
        });

        test('los demás no ven nada: perfil, biblioteca y stats → 404 como un usuario inexistente', async () => {
            const ghost = await request(app).get('/api/users/no_existe_jest').set(auth(vToken));
            for (const path of ['/api/users/deact_jest', '/api/users/deact_jest/library', '/api/users/deact_jest/stats']) {
                const res = await request(app).get(path).set(auth(vToken));
                expect(res.statusCode).toBe(404);
                expect(res.body).toEqual(ghost.body);
            }
        });

        test('los demás no ven nada: feed global, reseñas por libro y "me gusta" dados', async () => {
            const feed = await request(app).get('/api/readings/feed?limit=50').set(auth(vToken));
            expect(feed.body.some((r) => r.username === 'deact_jest')).toBe(false);

            const bookFeed = await request(app).get(`/api/books/feed?external_id=${encodeURIComponent(BOOK_D1.external_id)}`);
            expect(bookFeed.statusCode).toBe(200);
            expect(bookFeed.body).toHaveLength(0);

            // Su "me gusta" en la lectura del visitante deja de contar mientras está desactivada.
            expect(await likesOf(vToken, vLog)).toBe(0);
            const vFeedItem = feed.body.find((r) => r.id === vLog);
            expect(vFeedItem.likes_count).toBe(0);

            // ...ni en las estadísticas públicas del visitante.
            const vStats = await request(app).get('/api/users/visit_jest/stats').set(auth(vToken));
            expect(vStats.body.total_likes).toBe(0);
        });

        test('reactivar: restaura cada lectura exactamente; la bloqueada por moderación sigue privada', async () => {
            // Mientras estaba desactivada, la moderación bloqueó C (D4). Además, los términos
            // vigentes cambiaron: reactivar NO los exige (restaura, no publica nada nuevo).
            await db.query('UPDATE reading_logs SET moderation_locked_at = NOW() WHERE id = ?', [pubC]);
            await db.query('UPDATE users SET terms_version = NULL WHERE id = ?', [dId]);

            const status = await request(app).get('/api/account/status').set(auth(dToken));
            expect(status.body.restorable_readings).toBe(1);

            const res = await reactivate();
            expect(res.statusCode).toBe(200);
            expect(res.body).toEqual({ status: 'active', restored_readings: 1 });

            expect(await visibility()).toEqual({
                [pubA]: [1, null],
                [privB]: [0, null],
                [pubC]: [0, null],
            });
            expect((await userRow()).status).toBe('active');
            await db.query("UPDATE users SET terms_version = '2026-11' WHERE id = ?", [dId]);
        });

        test('reactivar una cuenta activa → 409', async () => {
            const res = await reactivate();
            expect(res.statusCode).toBe(409);
            expect(res.body.code).toBe('CONFLICT');
        });

        test('tras reactivar: vuelve a ser visible y sus "me gusta" vuelven a contar', async () => {
            const profile = await request(app).get('/api/users/deact_jest').set(auth(vToken));
            expect(profile.statusCode).toBe(200);
            expect(profile.body.library.map((r) => r.id)).toEqual([pubA]);

            expect(await likesOf(vToken, vLog)).toBe(1);
            expect(await likesOf(dToken, pubA)).toBe(1);

            const feed = await request(app).get('/api/readings/feed').set(auth(dToken));
            expect(feed.statusCode).toBe(200);
            const bookFeed = await request(app).get(`/api/books/feed?external_id=${encodeURIComponent(BOOK_D1.external_id)}`);
            expect(bookFeed.body.map((r) => r.review_text)).toEqual(['Reseña A']);
        });

        test('dos desactivaciones simultáneas: una gana, la otra 409, la visibilidad queda intacta', async () => {
            const [r1, r2] = await Promise.all([deactivate(), deactivate()]);
            expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 409]);
            expect(await visibility()).toEqual({
                [pubA]: [0, 1],
                [privB]: [0, 0],
                [pubC]: [0, 0],
            });
            const back = await reactivate();
            expect(back.body.restored_readings).toBe(1);
        });

        test('una cuenta suspendida no puede reactivarse ni desactivarse por su cuenta', async () => {
            await db.query("UPDATE users SET status = 'suspended' WHERE id = ?", [dId]);
            try {
                const re = await reactivate();
                expect(re.statusCode).toBe(403);
                expect(re.body.code).toBe('FORBIDDEN');
                const de = await deactivate();
                expect(de.statusCode).toBe(403);
            } finally {
                await db.query("UPDATE users SET status = 'active' WHERE id = ?", [dId]);
            }
        });
    });

    // ------------------------------------------------------------------
    describe('Eliminar la cuenta (2.2)', () => {
        const BOOK_X1 = { external_id: '/works/OLX1W', title: 'Libro a Borrar 1', page_count: 90 };
        const BOOK_X2 = { external_id: '/works/OLX2W', title: 'Libro a Borrar 2', page_count: 90 };
        const BOOK_W1 = { external_id: '/works/OLW1W', title: 'Libro del Testigo', page_count: 90 };
        const PASSWORD = 'password123';

        let xToken; // cuenta que se elimina
        let xRefresh;
        let xId;
        let xLogs = []; // ids de sus lecturas (para buscar "me gusta"/sesiones recibidos)
        let wToken; // testigo: otra cuenta que sigue existiendo
        let wLog; // lectura pública del testigo, con un "me gusta" de la cuenta eliminada
        const auditIds = [];

        const register = (username) =>
            request(app).post('/api/auth/register')
                .send({ username, email: `${username}@jest.com`, password: PASSWORD, accept_terms: true });
        const createLog = (token, bookData, logData) =>
            request(app).post('/api/readings').set(auth(token)).send({ bookData, logData });
        const deleteAccount = (token, password = PASSWORD) =>
            request(app).delete('/api/account').set(auth(token)).send({ password });
        const likesOf = async (token, logId) => {
            const res = await request(app).get('/api/readings/my-library?limit=50').set(auth(token));
            return res.body.find((r) => r.id === logId).likes_count;
        };

        /**
         * Busca al usuario en TODA la BD de tests, sin una lista de tablas escrita a mano:
         * - toda columna con FK a users.id o con nombre de referencia a usuario (user_id, *_user_id,
         *   admin_id, reporter_id, blocker_id, blocked_id, resolved_by);
         * - toda columna con FK a reading_logs.id o llamada reading_log_id, contra sus lecturas;
         * - toda tabla con target_type + target_id ('user' = la cuenta, 'reading' = sus lecturas);
         * - users por id, username y email.
         * Devuelve { 'tabla.columna': filas } solo con lo que encontró (vacío = sin rastro).
         */
        const traces = async (userId, username, logIds) => {
            const ids = logIds.length > 0 ? logIds : [0];
            const [userCols] = await db.query(`
                SELECT table_name AS t, column_name AS c FROM information_schema.columns
                WHERE table_schema = DATABASE()
                  AND (column_name REGEXP '(^|_)user_id$'
                       OR column_name IN ('admin_id', 'reporter_id', 'blocker_id', 'blocked_id', 'resolved_by'))
                UNION
                SELECT table_name, column_name FROM information_schema.key_column_usage
                WHERE table_schema = DATABASE() AND referenced_table_name = 'users'`);
            const [logCols] = await db.query(`
                SELECT table_name AS t, column_name AS c FROM information_schema.columns
                WHERE table_schema = DATABASE() AND column_name = 'reading_log_id'
                UNION
                SELECT table_name, column_name FROM information_schema.key_column_usage
                WHERE table_schema = DATABASE() AND referenced_table_name = 'reading_logs'`);
            const [targetTables] = await db.query(`
                SELECT table_name AS t FROM information_schema.columns
                WHERE table_schema = DATABASE() AND column_name IN ('target_type', 'target_id')
                GROUP BY table_name HAVING COUNT(*) = 2`);

            // Cordura: si el esquema cambiara de nombres, el test no debe pasar "en vacío".
            const found = userCols.map((r) => `${r.t}.${r.c}`);
            for (const expected of ['reading_logs.user_id', 'reading_likes.user_id', 'reading_sessions.user_id',
                'reading_goals.user_id', 'refresh_tokens.user_id', 'password_resets.user_id', 'admin_actions.admin_id']) {
                expect(found).toContain(expected);
            }
            expect(targetTables.map((r) => r.t)).toContain('admin_actions');

            const out = {};
            const count = async (key, sql, params) => {
                const [rows] = await db.query(sql, params);
                if (rows[0].n > 0) out[key] = rows[0].n;
            };
            for (const { t, c } of userCols) {
                if (t === 'users') continue;
                await count(`${t}.${c}`, `SELECT COUNT(*) AS n FROM \`${t}\` WHERE \`${c}\` = ?`, [userId]);
            }
            for (const { t, c } of logCols) {
                await count(`${t}.${c}`, `SELECT COUNT(*) AS n FROM \`${t}\` WHERE \`${c}\` IN (?)`, [ids]);
            }
            for (const { t } of targetTables) {
                await count(`${t}.target_id`,
                    `SELECT COUNT(*) AS n FROM \`${t}\`
                     WHERE (target_type = 'user' AND target_id = ?) OR (target_type = 'reading' AND target_id IN (?))`,
                    [userId, ids]);
            }
            await count('users', 'SELECT COUNT(*) AS n FROM users WHERE id = ? OR username = ? OR email = ?',
                [userId, username, `${username}@jest.com`]);
            return out;
        };

        beforeAll(async () => {
            const x = await register('borrar_jest');
            xToken = x.body.token;
            xRefresh = x.body.refresh_token;
            xId = x.body.user.id;
            wToken = (await register('testigo_jest')).body.token;

            // Lecturas: una pública con reseña y una privada; el testigo registra el MISMO libro
            // (el catálogo es compartido y no debe borrarse).
            const pub = (await createLog(xToken, BOOK_X1, { status: 'terminado', rating: 4, review_text: 'Reseña X', is_log_public: true })).body.logId;
            const priv = (await createLog(xToken, BOOK_X2, { status: 'leyendo', is_log_public: false })).body.logId;
            xLogs = [pub, priv];
            wLog = (await createLog(wToken, BOOK_W1, { status: 'terminado', review_text: 'Reseña W', is_log_public: true })).body.logId;
            await createLog(wToken, BOOK_X1, { status: 'leyendo', is_log_public: false });

            await request(app).post(`/api/readings/${priv}/session`).set(auth(xToken))
                .send({ duration_minutes: 15, pages_read: 8 });
            await request(app).post('/api/users/goal').set(auth(xToken)).send({ target_books: 12 });
            await request(app).post(`/api/readings/${wLog}/like`).set(auth(xToken)); // "me gusta" dado
            await request(app).post(`/api/readings/${pub}/like`).set(auth(wToken)); // "me gusta" recibido
            await request(app).post('/api/auth/forgot-password').send({ email: 'borrar_jest@jest.com' });

            // Auditoría: la cuenta como admin que actuó y como objetivo (cuenta y lectura).
            for (const [adminId, type, target] of [[xId, 'user', null], [null, 'user', xId], [null, 'reading', pub]]) {
                const [r] = await db.query(
                    'INSERT INTO admin_actions (admin_id, action, target_type, target_id, note) VALUES (?, ?, ?, ?, ?)',
                    [adminId, 'test.audit', type, target, 'nota de prueba']
                );
                auditIds.push(r.insertId);
            }
        });

        test('antes de borrar, la búsqueda genérica SÍ encuentra sus datos en cada tabla', async () => {
            const found = await traces(xId, 'borrar_jest', xLogs);
            expect(Object.keys(found)).toEqual(expect.arrayContaining([
                'reading_logs.user_id', 'reading_likes.user_id', 'reading_likes.reading_log_id',
                'reading_sessions.user_id', 'reading_goals.user_id', 'refresh_tokens.user_id',
                'password_resets.user_id', 'admin_actions.admin_id', 'admin_actions.target_id', 'users',
            ]));
            expect(await likesOf(wToken, wLog)).toBe(1);
        });

        test('sin token → 401', async () => {
            const res = await request(app).delete('/api/account').send({ password: PASSWORD });
            expect(res.statusCode).toBe(401);
            expect(res.body.code).toBe('UNAUTHORIZED');
        });

        test('sin contraseña → 400', async () => {
            const res = await request(app).delete('/api/account').set(auth(xToken)).send({});
            expect(res.statusCode).toBe(400);
            expect(res.body.code).toBe('VALIDATION_ERROR');
        });

        test('contraseña incorrecta → 401 INVALID_PASSWORD, nada cambia y la sesión sigue', async () => {
            const before = await traces(xId, 'borrar_jest', xLogs);
            const res = await deleteAccount(xToken, 'incorrecta');
            expect(res.statusCode).toBe(401);
            expect(res.body.code).toBe('INVALID_PASSWORD');
            expect(await traces(xId, 'borrar_jest', xLogs)).toEqual(before);
            const lib = await request(app).get('/api/readings/my-library').set(auth(xToken));
            expect(lib.statusCode).toBe(200);
        });

        test('borrar: 200 { deleted: true } y NINGÚN rastro del usuario en ninguna tabla', async () => {
            const res = await deleteAccount(xToken);
            expect(res.statusCode).toBe(200);
            expect(res.body).toEqual({ deleted: true });
            expect(await traces(xId, 'borrar_jest', xLogs)).toEqual({});
        });

        test('los libros del catálogo siguen existiendo', async () => {
            const [rows] = await db.query('SELECT external_id FROM books WHERE external_id IN (?, ?)',
                [BOOK_X1.external_id, BOOK_X2.external_id]);
            expect(rows).toHaveLength(2);
            // Y la lectura del testigo sobre el mismo libro sigue ahí.
            const lib = await request(app).get('/api/readings/my-library?limit=50').set(auth(wToken));
            expect(lib.body.map((r) => r.external_id)).toContain(BOOK_X1.external_id);
        });

        test('su "me gusta" en una lectura ajena desaparece y el contador baja', async () => {
            expect(await likesOf(wToken, wLog)).toBe(0);
            const [rows] = await db.query('SELECT COUNT(*) AS n FROM reading_likes WHERE reading_log_id = ?', [wLog]);
            expect(rows[0].n).toBe(0);
        });

        test('la auditoría se conserva, pero sin vínculo con la cuenta eliminada', async () => {
            const [rows] = await db.query('SELECT admin_id, target_id FROM admin_actions WHERE id IN (?)', [auditIds]);
            expect(rows).toHaveLength(3);
            for (const r of rows) expect(r).toEqual({ admin_id: null, target_id: null });
        });

        test('tras borrar: el token viejo → 401 y el refresh → 401', async () => {
            const lib = await request(app).get('/api/readings/my-library').set(auth(xToken));
            expect(lib.statusCode).toBe(401);
            const status = await request(app).get('/api/account/status').set(auth(xToken));
            expect(status.statusCode).toBe(401);
            const again = await deleteAccount(xToken);
            expect(again.statusCode).toBe(401);
            const refreshed = await request(app).post('/api/auth/refresh').send({ refresh_token: xRefresh });
            expect(refreshed.statusCode).toBe(401);
        });

        test('login con sus credenciales → el mismo 401 que una cuenta inexistente', async () => {
            const ghost = await request(app).post('/api/auth/login')
                .send({ username: 'nunca_existio_jest', password: PASSWORD });
            for (const body of [{ username: 'borrar_jest', password: PASSWORD }, { email: 'borrar_jest@jest.com', password: PASSWORD }]) {
                const res = await request(app).post('/api/auth/login').send(body);
                expect(res.statusCode).toBe(401);
                expect(res.body).toEqual(ghost.body);
            }
        });

        test('el username y el email quedan libres para registrarse de nuevo', async () => {
            const res = await register('borrar_jest');
            expect(res.statusCode).toBe(201);
            expect(res.body.user.id).not.toBe(xId);
            // La cuenta nueva empieza vacía: nada de la anterior.
            const lib = await request(app).get('/api/readings/my-library').set(auth(res.body.token));
            expect(lib.body).toEqual([]);
        });

        test('una cuenta desactivada también puede eliminarse', async () => {
            const d = await register('borrar_desact_jest');
            const log = (await createLog(d.body.token, BOOK_X2, { status: 'leyendo', is_log_public: true })).body.logId;
            const deact = await request(app).post('/api/account/deactivate').set(auth(d.body.token)).send({ password: PASSWORD });
            expect(deact.statusCode).toBe(200);

            const res = await deleteAccount(d.body.token);
            expect(res.statusCode).toBe(200);
            expect(await traces(d.body.user.id, 'borrar_desact_jest', [log])).toEqual({});
        });

        test('una cuenta suspendida también puede eliminarse (Google exige que cualquiera pueda)', async () => {
            const s = await register('borrar_susp_jest');
            await db.query("UPDATE users SET status = 'suspended' WHERE id = ?", [s.body.user.id]);
            const res = await deleteAccount(s.body.token);
            expect(res.statusCode).toBe(200);
            expect(await traces(s.body.user.id, 'borrar_susp_jest', [])).toEqual({});
        });

        test('dos borrados simultáneos: uno 200 y el otro 401, nunca 500', async () => {
            const c = await register('borrar_doble_jest');
            const log = (await createLog(c.body.token, BOOK_X1, { status: 'leyendo', is_log_public: true })).body.logId;
            const [r1, r2] = await Promise.all([deleteAccount(c.body.token), deleteAccount(c.body.token)]);
            expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 401]);
            expect(await traces(c.body.user.id, 'borrar_doble_jest', [log])).toEqual({});
        });
    });
});
