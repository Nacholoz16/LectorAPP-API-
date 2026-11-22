/**
 * Versión vigente de los Términos y la Política de privacidad (tarea 1.3).
 *
 * Única fuente de verdad: el registro la guarda en `users.terms_version` y `POST /account/terms`
 * la acepta. Cambiarla obliga a TODOS los usuarios a volver a aceptar antes de publicar
 * (crear o dejar pública una lectura responde 403 TERMS_REQUIRED hasta entonces).
 * Debe coincidir con la versión que muestran las páginas legales de lectorapp-web.
 */
const CURRENT_TERMS_VERSION = '2026-11';

/**
 * Estado de aceptación para el cliente, a partir de la versión que tiene guardada el usuario.
 * Se expone junto al usuario en login/registro/reset y en el perfil propio.
 */
const termsStatus = (acceptedVersion) => ({
    terms_version: acceptedVersion ?? null,
    current_terms_version: CURRENT_TERMS_VERSION,
    needs_terms: acceptedVersion !== CURRENT_TERMS_VERSION,
});

module.exports = { CURRENT_TERMS_VERSION, termsStatus };
