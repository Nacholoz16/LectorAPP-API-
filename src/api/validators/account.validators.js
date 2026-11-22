const { z } = require('zod');

/**
 * Confirmar una acción sobre la cuenta con la contraseña actual (desactivar; en la 2.2, eliminar).
 * Solo se exige que venga: el formato lo decidió el registro y bcrypt ignora lo que pase de 72 bytes.
 */
const passwordConfirmSchema = z.object({
    password: z.string().min(1, 'Escribe tu contraseña').max(256),
});

module.exports = { passwordConfirmSchema };
