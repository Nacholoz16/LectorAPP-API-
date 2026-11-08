const { z } = require('zod');

const goalSchema = z.object({
    target_books: z.coerce.number().int().min(1, 'Meta inválida').max(1000, 'Meta inválida'),
});

const privacySchema = z
    .object({
        is_profile_public: z.boolean().optional(),
        are_stats_public: z.boolean().optional(),
    })
    .strict()
    .refine(
        (d) => d.is_profile_public !== undefined || d.are_stats_public !== undefined,
        'Debes enviar al menos un ajuste de privacidad'
    );

module.exports = { goalSchema, privacySchema };
