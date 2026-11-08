require('dotenv').config({ quiet: true });

const REQUIRED_VARS = ['DB_HOST', 'DB_USER', 'DB_NAME', 'JWT_SECRET'];
const MIN_JWT_SECRET_LENGTH = 32;

/**
 * Falla rápido al arrancar si la configuración es insegura o incompleta,
 * en lugar de descubrirlo con el primer login.
 */
function validateEnv() {
    const missing = REQUIRED_VARS.filter((key) => !process.env[key]);
    if (missing.length > 0) {
        throw new Error(`Faltan variables de entorno requeridas: ${missing.join(', ')}`);
    }
    if (process.env.JWT_SECRET.length < MIN_JWT_SECRET_LENGTH) {
        throw new Error(`JWT_SECRET debe tener al menos ${MIN_JWT_SECRET_LENGTH} caracteres`);
    }
    const smtp = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'].filter((key) => !process.env[key]);
    if (process.env.NODE_ENV === 'production' && smtp.length > 0) {
        // No se bloquea el arranque: la API funciona, pero "Olvidé mi contraseña" no enviará correos.
        console.warn(`[env] Falta configurar ${smtp.join(', ')}: los correos de recuperación no se enviarán.`);
    }
}

module.exports = { validateEnv };
