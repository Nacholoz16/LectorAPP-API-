# Despliegue de Lectorapp API

Guía para publicar una versión nueva de la API en producción (`api.nacholoz3d.cl`, Node detrás de Nginx).

> **App y API van juntas.** Si la versión cambia el contrato (como el feed paginado por cursor),
> la app vieja deja de funcionar bien contra la API nueva y viceversa. Publica la API y, enseguida,
> la versión de la app que la usa.

## 1. Antes de desplegar (en tu PC)

```bash
npm run test:setup   # asegura el esquema de la BD de test
npm test             # todo en verde
npm audit            # revisar vulnerabilidades de dependencias
```

## 2. Respaldo de la base de datos de producción

Siempre, antes de migrar:

```bash
mysqldump -u <usuario> -p --single-transaction --routines <DB_NAME> > backup_$(date +%F).sql
```

## 3. Variables de entorno (`.env` del servidor)

Revisa que el `.env` de producción tenga todo lo de `.env.example`:

- `NODE_ENV=production`: activa el nivel de log `info` y oculta detalles de errores.
- `JWT_SECRET`: **mínimo 32 caracteres**. La API no arranca si es más corto.
- `TRUST_PROXY=1`: Nginx delante. Sin esto, el rate limiting ve a todos los usuarios como una sola IP.
- `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `PORT`.

## 4. Subir el código e instalar

```bash
git pull                     # o el método que uses para subir el código
npm ci --omit=dev            # instala exactamente package-lock.json, sin dependencias de desarrollo
```

## 5. Migrar la base de datos

```bash
npm run migrate
```

Es idempotente: se puede ejecutar varias veces. Revisa la salida:

- Si dice **"ABORTADO: hay lecturas duplicadas"**, hay que resolver esos registros a mano (dejar uno por usuario y libro) y volver a ejecutarla.
- Si avisa de **usernames fuera de formato**, esos usuarios no podrán abrirse vía `/users/:username` hasta renombrarlos.

## 6. Reiniciar el proceso

Según cómo corra Node en el servidor, por ejemplo:

```bash
pm2 restart lectorapp-api     # si usas pm2
# o: sudo systemctl restart lectorapp-api
```

## 7. Verificar

```bash
curl https://api.nacholoz3d.cl/api/health          # {"status":"OK","db":"Connected"}
curl -i https://api.nacholoz3d.cl/api/no-existe    # 404 con {"error":...,"code":"NOT_FOUND"}
```

Luego, desde la app nueva: login, feed (scroll), like, registrar una lectura y logout.

En los logs (`pm2 logs` / `journalctl`) deben verse líneas JSON con método, URL, status y tiempo,
**sin** contraseñas, emails ni tokens.

## 8. Mantenimiento

- `npm run cleanup` (o el evento MySQL que crea ese script) borra los tokens revocados que ya expiraron.
- Para revertir: vuelve al commit anterior, `npm ci --omit=dev`, reinicia, y si hace falta restaura el respaldo del paso 2.
