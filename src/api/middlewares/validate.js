const { z } = require('zod');
const { ValidationError } = require('../../utils/errors');

/**
 * Formatea el primer issue de Zod en un mensaje legible para el cliente.
 */
const formatIssue = (error) => {
    const issue = error.issues[0];
    if (!issue) return 'Datos inválidos';
    const path = issue.path.length ? `${issue.path.join('.')}: ` : '';
    return `${path}${issue.message}`;
};

/**
 * Middleware de validación con Zod.
 *
 * Uso: router.post('/', validate({ body: schema, query: schema, params: schema }), handler)
 *
 * - `req.body` se reemplaza por el resultado parseado (valores normalizados, campos
 *   desconocidos eliminados).
 * - Query y params quedan en `req.validated.query` / `req.validated.params`, porque en
 *   Express 5 `req.query` es un getter de solo lectura.
 */
const validate = (schemas) => (req, res, next) => {
    try {
        req.validated = req.validated || {};
        if (schemas.params) req.validated.params = schemas.params.parse(req.params);
        if (schemas.query) req.validated.query = schemas.query.parse(req.query);
        if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
        next();
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new ValidationError(formatIssue(error)));
        }
        next(error);
    }
};

module.exports = { validate };
