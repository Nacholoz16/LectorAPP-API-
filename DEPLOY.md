# Despliegue de Lectorapp API

Producción: `https://api.nacholoz3d.cl`, servidor `ubuntu@155.181.180.178` (ARM64, Docker).

> **App y API van juntas.** Si una versión cambia el contrato de la API (como el feed paginado por
> cursor), publica la API y enseguida la versión de la app que la usa.

## Cómo está montado el servidor

```
/home/ubuntu/[LECTORAPP]/
├── docker-compose.yml   # servicios: db (lectorDB), api (lectorAPI), frontend (lectorFront, front web viejo: NO tocar)
├── .env                 # SECRETOS (chmod 600, NO está en git): MYSQL_*, JWT_SECRET, NODE_ENV, TRUST_PROXY...
├── api/                 # clon git de este repo (github.com/Nacholoz16/LectorAPP-API-), montado en /app del contenedor
├── mysql-data/          # datos de MySQL
├── frontend/            # front Ionic/Angular compilado
└── backups/             # respaldos (.sql, compose y versiones anteriores de api/)
```

- El contenedor `lectorAPI` usa `node:22-alpine` y al arrancar ejecuta `npm ci --omit=dev && npm start`.
- **Nginx Proxy Manager** (`nginx_proxy`) recibe HTTPS y reenvía `api.nacholoz3d.cl` → `lectorAPI:3000`. Es un solo proxy, por eso `TRUST_PROXY=1`.

## Deploy normal (desde tu PC con Windows)

1. Prueba en local: `npm test` debe salir en verde.
2. Sube a GitHub: `git push origin main`.
3. Ejecuta **`deploy\deploy.bat`**.

El `.bat` entra por SSH (PuTTY/`plink` + la llave `.ppk`), deja `api/` en `origin/main` y ejecuta `deploy/remote-deploy.sh`, que hace esto:

1. Recrea **solo** el contenedor de la API (la BD y el front no se reinician).
2. Espera a que `/api/health` responda.
3. Ejecuta `npm run migrate` (idempotente).

La llave por defecto se busca en `%USERPROFILE%\Downloads\LLAVE SERVER 129.151.98.217.ppk`. Si la mueves (recomendado: `%USERPROFILE%\.ssh\`), define la variable de entorno `LECTORAPP_SSH_KEY` con la nueva ruta.

## Rollback

```bat
deploy\deploy.bat <commit-anterior>
```

`git log --oneline` muestra los commits. La migración solo añade columnas, tablas e índices y convierte tokens a hash, así que no hace falta revertirla.

## Respaldo de la base de datos

Antes de cambios grandes, en el servidor:

```bash
cd "/home/ubuntu/[LECTORAPP]"
docker exec lectorDB sh -c 'mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines anti_social_reader' > backups/db-$(date +%F).sql
```

Restaurar:

```bash
docker exec -i lectorDB sh -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" anti_social_reader' < backups/db-AAAA-MM-DD.sql
```

## Variables de entorno (`/home/ubuntu/[LECTORAPP]/.env`)

| Variable | Uso |
|---|---|
| `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD` | Credenciales de MySQL (la API usa `MYSQL_PASSWORD` como `DB_PASSWORD`) |
| `JWT_SECRET` | **≥ 32 caracteres** (la API no arranca si es más corto). Cambiarlo cierra todas las sesiones |
| `NODE_ENV=production` | Log nivel `info`, sin detalles de errores al cliente |
| `TRUST_PROXY=1` | IP real del cliente detrás de Nginx (necesario para el rate limiting) |
| `LOG_LEVEL` | Opcional (`info` por defecto en producción) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Correo de "Olvidé mi contraseña". Sin ellos la API arranca, pero los códigos no se envían (queda un error en el log). El `docker-compose.yml` debe pasarlas al servicio `api` |

Si cambias el `.env`, aplica con `deploy\deploy.bat`, que recrea el contenedor.

## Verificar

```bash
curl https://api.nacholoz3d.cl/api/health          # {"status":"OK","db":"Connected"}
curl -i https://api.nacholoz3d.cl/api/no-existe    # 404 {"error":...,"code":"NOT_FOUND"}
```

Logs en el servidor: `docker logs -f lectorAPI`. Son líneas JSON con método, URL, status y tiempo, **sin** contraseñas ni tokens.

## Mantenimiento

- `docker exec lectorAPI npm run cleanup` borra los tokens revocados que ya expiraron.

## Administrador (`users.role`)

Todo `/api/admin/*` exige token + `users.role = 'admin'` (el rol se lee de la BD en cada petición;
si se quita, la sesión del admin pierde el acceso en la petición siguiente). **Ningún endpoint puede
cambiar el rol**: se asigna solo así. Cada acción de moderación queda en la tabla `admin_actions`.

El administrador es `test001` (decisión D3). Tras el deploy que crea la columna (la migración del
paso 3 de "Deploy normal" la añade), en el servidor:

```bash
# 1. Comprobar que la cuenta existe en producción
docker exec lectorAPI npm run --silent admin:grant -- test001
#    → "Listo: ... ahora es administrador" o "ya es administrador" (idempotente).
#    Si la cuenta no existe, avisa y sale con código 1 sin tocar nada.
```

Alternativa por SQL directo:

```bash
docker exec -it lectorDB sh -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" anti_social_reader'
```
```sql
SELECT id, username, role FROM users WHERE username = 'test001';   -- confirmar que existe
UPDATE users SET role = 'admin' WHERE username = 'test001';
-- Quitar el rol (efecto inmediato):
UPDATE users SET role = 'user' WHERE username = 'test001';
```

En local: `npm run admin:grant` (por defecto `test001`; usa la BD del `.env`).

## Términos y condiciones (`users.terms_version`)

La versión vigente vive en `src/config/terms.js` (`CURRENT_TERMS_VERSION`, hoy `2026-11`) y debe
coincidir con la que muestran las páginas legales de la web (`/terminos`, `/privacidad`).

- El registro exige `accept_terms: true` y guarda versión y fecha. **Una app anterior a la 1.1.0 no
  envía ese campo: no podrá crear cuentas en cuanto se despliegue esta API** (sí iniciar sesión y
  usar el resto). Desplegar la API junto con la publicación de la app nueva.
- Crear o dejar pública una lectura sin la versión vigente aceptada → `403 TERMS_REQUIRED`
  (`POST /api/account/terms` la acepta). Las cuentas existentes quedan con `terms_version = NULL`
  tras la migración; sus lecturas públicas no se modifican.
- **Cambiar `CURRENT_TERMS_VERSION`** obliga a todos a volver a aceptar antes de publicar: hacerlo
  solo cuando cambie el contenido de las reglas, a la vez que la web.

Consultar quién aceptó qué:

```sql
SELECT terms_version, COUNT(*) FROM users GROUP BY terms_version;
```

## Desactivar / reactivar la cuenta (`users.status`)

Tarea 2.1 (decisión D7). `npm run migrate` (paso 10) crea `users.status` (todas las cuentas quedan
`active`), `users.status_changed_at`, `reading_logs.public_before_deactivation` y
`reading_logs.moderation_locked_at` (esta última la usará la moderación, 3.1).

- `POST /api/account/deactivate` (con contraseña) guarda la visibilidad de cada lectura y las deja
  privadas; `POST /api/account/reactivate` las devuelve como estaban (salvo las bloqueadas por
  moderación). `GET /api/account/status` da los conteos para los textos de la app.
- Una cuenta desactivada puede iniciar sesión, renovar y cerrar sesión, ver su biblioteca y las
  estadísticas de sus libros; todo lo demás responde `403 ACCOUNT_DEACTIVATED`. Para los demás, su
  perfil responde 404 y sus "me gusta" dejan de contar (no se borran).
- **Compatibilidad:** una app anterior a la 1.1.0 no conoce ese código; si la cuenta está desactivada
  verá errores genéricos ("Tu cuenta está desactivada…"). Solo se puede desactivar desde la app nueva,
  así que basta con desplegar la API junto con su publicación.
- Contraseña incorrecta al desactivar → `401 INVALID_PASSWORD` (5 fallos por cuenta cada 15 min).

Consultar o revertir a mano (por ejemplo, si alguien escribe pidiendo ayuda):

```sql
SELECT status, COUNT(*) FROM users GROUP BY status;
-- Reactivar a mano: mejor pedirle que use "Reactivar mi cuenta" en la app (restaura la
-- visibilidad de sus lecturas); un UPDATE de status solo NO la restaura.
```

## Eliminar la cuenta (`DELETE /api/account`)

Tarea 2.2. **No hay migración**: no cambia el esquema.

- `DELETE /api/account` con `{ password }` borra en una transacción la cuenta y todo lo suyo:
  lecturas (con reseñas), "me gusta" dados y recibidos, sesiones del cronómetro, metas, refresh
  tokens y códigos de recuperación. Los libros (catálogo compartido) **no** se borran. En
  `admin_actions` las filas se conservan, pero `admin_id`/`target_id` que apuntaban a la cuenta o a
  sus lecturas quedan en `NULL`. Responde `200 { deleted: true }`.
- Funciona con la cuenta activa, desactivada o suspendida. Contraseña incorrecta → `401
  INVALID_PASSWORD` (comparte con `/deactivate` el límite de 5 fallos por cuenta cada 15 min).
- La lógica vive en `src/services/accountDeletion.service.js` (`deleteUserCompletely`), que la
  web (2.3) reutilizará. **Toda tabla nueva con datos de un usuario se añade ahí** (bloqueos,
  denuncias, suspensiones…); el test E2E "ningún rastro" recorre el esquema y falla si se olvida.
- **No es reversible.** Los respaldos de `mysqldump` (sección "Respaldo") sí contienen los datos
  borrados hasta que se eliminen: no restaurar un respaldo antiguo sin tenerlo en cuenta.
- No se borra la cuenta "a mano" con `DELETE FROM users`: en la BD de producción no todas las
  tablas tienen `ON DELETE CASCADE` garantizado. Si alguien lo pide por correo, indicarle la ruta
  en la app (Perfil → Ajustes → Cuenta → Eliminar mi cuenta) o, cuando exista (2.3), la web.
