const { z } = require('zod');
const db = require('../config/db');
const { ValidationError } = require('../utils/errors');

const NOTE_MAX = 500;

// Identificadores internos (no texto del usuario): formato acotado para que la auditoría
// sea consultable y no acepte basura. Ej.: action 'user.suspend', target_type 'user'.
const auditEntrySchema = z.object({
    adminId: z.number().int().positive(),
    action: z.string().regex(/^[a-z][a-z0-9_.]{1,49}$/, 'Acción de auditoría inválida'),
    targetType: z.string().regex(/^[a-z][a-z0-9_]{1,29}$/, 'Tipo de objetivo inválido'),
    targetId: z.number().int().positive().nullable().optional(),
    // La nota sí la escribe el admin: se recorta y una vacía se guarda como NULL.
    note: z
        .string()
        .trim()
        .max(NOTE_MAX, `La nota no puede superar los ${NOTE_MAX} caracteres`)
        .nullable()
        .optional(),
});

/**
 * Registra una acción de administración en `admin_actions` (quién, qué, a quién, cuándo, nota).
 *
 * @param {{ adminId: number, action: string, targetType: string, targetId?: number|null, note?: string|null }} entry
 * @param {object} [conn] Conexión de una transacción en curso. Pásala cuando la acción de
 *   moderación ocurre dentro de una transacción: así el registro se confirma o revierte junto
 *   con ella (nunca queda una acción sin auditar ni una auditoría de algo que no ocurrió).
 * @returns {Promise<number>} id de la fila creada.
 */
const logAdminAction = async (entry, conn) => {
    const parsed = auditEntrySchema.safeParse(entry ?? {});
    if (!parsed.success) {
        throw new ValidationError(parsed.error.issues[0]?.message || 'Datos de auditoría inválidos');
    }
    const { adminId, action, targetType, targetId, note } = parsed.data;

    const executor = conn ?? db;
    const [result] = await executor.execute(
        `INSERT INTO admin_actions (admin_id, action, target_type, target_id, note)
         VALUES (?, ?, ?, ?, ?)`,
        [adminId, action, targetType, targetId ?? null, note ? note : null]
    );
    return result.insertId;
};

module.exports = { logAdminAction, NOTE_MAX };
