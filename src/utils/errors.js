/**
 * Errores de aplicación tipados.
 * Los servicios/modelos lanzan estas clases y el middleware global de errores
 * (src/app.js) las traduce a `{ error, code }` con el status HTTP correcto.
 * Así los controladores no necesitan comparar strings de mensajes.
 */
class AppError extends Error {
    constructor(message, status = 500, code = 'INTERNAL_ERROR') {
        super(message);
        this.name = this.constructor.name;
        this.status = status;
        this.code = code;
    }
}

class ValidationError extends AppError {
    constructor(message = 'Datos inválidos') {
        super(message, 400, 'VALIDATION_ERROR');
    }
}

class UnauthorizedError extends AppError {
    constructor(message = 'No autorizado') {
        super(message, 401, 'UNAUTHORIZED');
    }
}

class ForbiddenError extends AppError {
    constructor(message = 'No tienes permiso para realizar esta acción') {
        super(message, 403, 'FORBIDDEN');
    }
}

/**
 * 403 con código propio: el cliente lo distingue de un FORBIDDEN normal para pedir que el
 * usuario acepte los términos vigentes y reintentar (tarea 1.3).
 */
class TermsRequiredError extends AppError {
    constructor(message = 'Para publicar necesitas aceptar los Términos y la Política de privacidad.') {
        super(message, 403, 'TERMS_REQUIRED');
    }
}

/**
 * 403 con código propio: la cuenta está desactivada por su dueño (tarea 2.1, D7). Solo puede
 * ver su biblioteca, reactivarla, cerrar sesión o eliminarla; el cliente pasa a modo solo lectura.
 */
class AccountDeactivatedError extends AppError {
    constructor(message = 'Tu cuenta está desactivada. Reactívala para volver a usar LectorApp.') {
        super(message, 403, 'ACCOUNT_DEACTIVATED');
    }
}

/**
 * 401 con código propio para "la contraseña que confirmaste no es correcta" en acciones de una
 * sesión ya iniciada (desactivar, y en el futuro eliminar la cuenta). El código distinto permite
 * al cliente NO tratarlo como sesión vencida (no renovar ni mandar a Login).
 */
class InvalidPasswordError extends AppError {
    constructor(message = 'La contraseña no es correcta.') {
        super(message, 401, 'INVALID_PASSWORD');
    }
}

class NotFoundError extends AppError {
    constructor(message = 'Recurso no encontrado') {
        super(message, 404, 'NOT_FOUND');
    }
}

class ConflictError extends AppError {
    constructor(message = 'El recurso ya existe') {
        super(message, 409, 'CONFLICT');
    }
}

/** true si el error de mysql2 es una violación de UNIQUE. */
const isDuplicateEntry = (err) => err && err.code === 'ER_DUP_ENTRY';

module.exports = {
    AppError,
    ValidationError,
    UnauthorizedError,
    ForbiddenError,
    TermsRequiredError,
    AccountDeactivatedError,
    InvalidPasswordError,
    NotFoundError,
    ConflictError,
    isDuplicateEntry,
};
