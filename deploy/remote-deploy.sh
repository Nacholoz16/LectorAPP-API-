#!/usr/bin/env bash
# =============================================================================
# Deploy de la API en el servidor (se ejecuta EN el servidor).
#
# Lo invoca deploy/deploy.bat desde el PC, DESPUÉS de dejar este repo
# (~/[LECTORAPP]/api) en el commit a desplegar (git fetch + checkout).
#
# Pasos:
#   1. Recrea SOLO el contenedor de la API (la BD y el front no se tocan).
#      --renew-anon-volumes descarta el node_modules anterior: `npm ci` instala
#      exactamente lo de package-lock.json del commit desplegado.
#   2. Espera a que /api/health responda (npm ci tarda al arrancar).
#   3. Ejecuta la migración idempotente (scripts/migrate.js).
# =============================================================================
set -euo pipefail

API_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_DIR="$(dirname "$API_DIR")"   # carpeta que contiene docker-compose.yml y .env
CONTAINER="lectorAPI"
HEALTH_TIMEOUT_S=180

cd "$PROJECT_DIR"

echo ">> Desplegando commit: $(git -C "$API_DIR" log -1 --format='%h %s')"

echo ">> Validando docker-compose.yml"
docker compose config -q

echo ">> Recreando contenedor de la API"
# --no-deps: no tocar lectorDB aunque api dependa de ella (--force-recreate la reiniciaría).
docker compose up -d --no-deps --force-recreate --renew-anon-volumes api

echo ">> Esperando /api/health (máx. ${HEALTH_TIMEOUT_S}s)"
elapsed=0
until docker exec "$CONTAINER" wget -qO- http://localhost:3000/api/health 2>/dev/null | grep -q '"status":"OK"'; do
    if [ "$elapsed" -ge "$HEALTH_TIMEOUT_S" ]; then
        echo "!! La API no respondió a tiempo. Últimos logs:"
        docker logs --tail 50 "$CONTAINER" 2>&1
        exit 1
    fi
    sleep 5
    elapsed=$((elapsed + 5))
done
echo ">> API saludable tras ${elapsed}s"

echo ">> Migración de base de datos"
docker exec "$CONTAINER" npm run --silent migrate

echo ">> Deploy OK: $(git -C "$API_DIR" log -1 --format='%h %s')"
docker logs --tail 5 "$CONTAINER" 2>&1
