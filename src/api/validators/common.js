const { z } = require('zod');

/** Usernames permitidos: seguros para usar en URLs (/users/:username). */
const USERNAME_REGEX = /^[a-zA-Z0-9_.-]{3,30}$/;

/** Paginación con tope: evita que un cliente pida limit=1000000. */
const MAX_PAGE_SIZE = 50;

const paginationQuery = z.object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(10),
});

const idParam = z.object({
    id: z.coerce.number().int().positive(),
});

const usernameParam = z.object({
    username: z.string().regex(USERNAME_REGEX, 'Nombre de usuario inválido'),
});

module.exports = { USERNAME_REGEX, MAX_PAGE_SIZE, paginationQuery, idParam, usernameParam };
