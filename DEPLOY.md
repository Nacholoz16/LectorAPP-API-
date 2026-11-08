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

`git log --oneline` muestra los commits. La migración solo crea índices y convierte tokens a hash, así que no hace falta revertirla.

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

Si cambias el `.env`, aplica con `deploy\deploy.bat`, que recrea el contenedor.

## Verificar

```bash
curl https://api.nacholoz3d.cl/api/health          # {"status":"OK","db":"Connected"}
curl -i https://api.nacholoz3d.cl/api/no-existe    # 404 {"error":...,"code":"NOT_FOUND"}
```

Logs en el servidor: `docker logs -f lectorAPI`. Son líneas JSON con método, URL, status y tiempo, **sin** contraseñas ni tokens.

## Mantenimiento

- `docker exec lectorAPI npm run cleanup` borra los tokens revocados que ya expiraron.
