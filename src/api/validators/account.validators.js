const { z } = require('zod');
const { emailSchema, emailCodeSchema } = require('./auth.validators');

/**
 * Confirmar una acción sobre la cuenta con la contraseña actual (desactivar, eliminar).
 * Solo se exige que venga: el formato lo decidió el registro y bcrypt ignora lo que pase de 72 bytes.
 */
const passwordConfirmSchema = z.object({
    password: z.string().min(1, 'Escribe tu contraseña').max(256),
});

/**
 * Eliminar la cuenta desde la web, sin sesión (tarea 2.3). El email se normaliza igual que en el
 * registro (trim + minúsculas) para encontrar la misma cuenta.
 */
const deletionRequestSchema = z.object({ email: emailSchema });

const deletionConfirmSchema = z.object({ email: emailSchema, code: emailCodeSchema });

module.exports = { passwordConfirmSchema, deletionRequestSchema, deletionConfirmSchema };
