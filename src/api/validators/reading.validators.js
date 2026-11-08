const { z } = require('zod');

const STATUS_VALUES = ['leyendo', 'terminado', 'abandonado'];

/** Hosts de portadas aceptados al crear un libro nuevo en la caché local. */
const ALLOWED_COVER_HOSTS = new Set([
    'covers.openlibrary.org',
    'books.google.com',
    'books.googleusercontent.com',
]);

const coverUrl = z
    .string()
    .url()
    .max(500)
    .refine((value) => {
        try {
            const url = new URL(value);
            return url.protocol === 'https:' && ALLOWED_COVER_HOSTS.has(url.hostname);
        } catch {
            return false;
        }
    }, 'URL de portada no permitida');

/** Fecha 'YYYY-MM-DD' (o null). Cadenas vacías se tratan como null. */
const dateOnly = z.preprocess(
    (v) => (v === '' ? null : v),
    z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (formato YYYY-MM-DD)')
        .refine((s) => !Number.isNaN(Date.parse(s)), 'Fecha inválida')
        .nullable()
);

/** Acepta true/false y también 1/0 (clientes antiguos). */
const boolish = z.union([z.boolean(), z.literal(1), z.literal(0)]).transform((v) => v === true || v === 1);

/** Rating 1-5; 0 o null significa "sin calificación". */
const rating = z
    .number()
    .int()
    .min(0)
    .max(5)
    .nullable()
    .transform((v) => (v ? v : null));

const logFields = {
    status: z.enum(STATUS_VALUES),
    rating: rating,
    review_text: z.string().trim().max(5000).nullable(),
    start_date: dateOnly,
    finish_date: dateOnly,
    is_log_public: boolish,
    current_page: z.number().int().min(0).max(100000),
};

const datesInOrder = (d) => !d.start_date || !d.finish_date || d.finish_date >= d.start_date;
const DATES_MESSAGE = { message: 'La fecha de término no puede ser anterior a la de inicio', path: ['finish_date'] };

const createLogData = z
    .object({
        ...logFields,
        status: logFields.status.default('leyendo'),
        rating: rating.optional().default(null),
        review_text: logFields.review_text.optional().default(null),
        start_date: dateOnly.optional().default(null),
        finish_date: dateOnly.optional().default(null),
        is_log_public: boolish.optional().default(false),
        current_page: logFields.current_page.optional().default(0),
    })
    .refine(datesInOrder, DATES_MESSAGE);

const bookData = z.object({
    // Open Library usa claves tipo "/works/OL123W"; registros antiguos pueden tener IDs de Google.
    external_id: z.string().trim().regex(/^[A-Za-z0-9/_-]{1,100}$/, 'external_id inválido'),
    title: z.string().trim().min(1).max(255),
    authors: z.string().trim().max(255).nullish(),
    cover_url: coverUrl.nullish(),
    isbn: z.union([z.string(), z.number()]).transform(String).pipe(z.string().max(20)).nullish(),
    page_count: z.number().int().min(0).max(100000).nullish(),
    published_year: z.number().int().min(-5000).max(3000).nullish(),
});

const createReadingSchema = z.object({
    bookData,
    logData: createLogData,
});

const updateReadingSchema = z
    .object(logFields)
    .partial()
    .refine((d) => Object.keys(d).length > 0, 'No se enviaron campos para actualizar')
    .refine(datesInOrder, DATES_MESSAGE);

const sessionSchema = z.object({
    duration_minutes: z.coerce.number().int().min(1).max(1440),
    pages_read: z.coerce.number().int().min(0).max(5000).default(0),
    current_page: z.coerce.number().int().min(0).max(100000).nullish(),
});

module.exports = {
    STATUS_VALUES,
    createReadingSchema,
    updateReadingSchema,
    sessionSchema,
};
