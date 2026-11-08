const { z } = require('zod');
const { USERNAME_REGEX } = require('./common');

// bcrypt solo considera los primeros 72 BYTES de la contraseña; más allá se ignora en silencio.
const BCRYPT_MAX_BYTES = 72;

const registerSchema = z.object({
    username: z
        .string()
        .trim()
        .regex(
            USERNAME_REGEX,
            'El nombre de usuario debe tener entre 3 y 30 caracteres (letras, números, punto, guion o guion bajo)'
        ),
    email: z.string().trim().toLowerCase().max(254).email('Email inválido'),
    password: z
        .string()
        .min(8, 'La contraseña debe tener al menos 8 caracteres')
        .refine(
            (p) => Buffer.byteLength(p, 'utf8') <= BCRYPT_MAX_BYTES,
            'La contraseña es demasiado larga'
        ),
});

const loginSchema = z
    .object({
        email: z.string().trim().toLowerCase().max(254).optional(),
        username: z.string().trim().max(30).optional(),
        password: z.string().min(1, 'La contraseña es obligatoria').max(256),
    })
    .refine((d) => d.email || d.username, 'Email o nombre de usuario requerido');

module.exports = { registerSchema, loginSchema };
