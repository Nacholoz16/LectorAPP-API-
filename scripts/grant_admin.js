/**
 * Asigna el rol de administrador a una cuenta existente (idempotente).
 *
 *   npm run admin:grant              → test001 (decisión D3 del backlog)
 *   npm run admin:grant -- <username>
 *
 * Usa la BD del .env (DB_NAME). Ningún endpoint de la API puede cambiar `users.role`:
 * esta es, junto con SQL directo, la única vía. Ver DEPLOY.md para producción.
 *
 * Requiere haber ejecutado antes `npm run migrate` (columna users.role).
 */
require('dotenv').config({ quiet: true });
const db = require('../src/config/db');
const { USERNAME_REGEX } = require('../src/api/validators/common');

const DEFAULT_ADMIN = 'test001';

async function grantAdmin() {
    const username = (process.argv[2] || DEFAULT_ADMIN).trim();
    if (!USERNAME_REGEX.test(username)) {
        console.error(`Nombre de usuario inválido: "${username}"`);
        process.exitCode = 1;
        return;
    }

    const [dbRow] = await db.query('SELECT DATABASE() AS name');
    console.log(`Base de datos: ${dbRow[0].name}`);

    const [rows] = await db.execute('SELECT id, role FROM users WHERE username = ? LIMIT 1', [username]);
    const user = rows[0];
    if (!user) {
        console.error(
            `ERROR: la cuenta "${username}" no existe en esta base de datos. ` +
                'Créala primero (registro normal en la app) y vuelve a ejecutar el script.'
        );
        process.exitCode = 1;
        return;
    }

    if (user.role === 'admin') {
        console.log(`"${username}" (id ${user.id}) ya es administrador. Nada que hacer.`);
        return;
    }

    await db.execute("UPDATE users SET role = 'admin' WHERE id = ?", [user.id]);
    console.log(`Listo: "${username}" (id ${user.id}) ahora es administrador.`);
}

grantAdmin()
    .catch((error) => {
        if (error && error.code === 'ER_BAD_FIELD_ERROR') {
            console.error('Falta la columna users.role: ejecuta antes `npm run migrate`.');
        } else {
            console.error('Error asignando el rol de administrador:', error);
        }
        process.exitCode = 1;
    })
    .finally(() => db.end());
