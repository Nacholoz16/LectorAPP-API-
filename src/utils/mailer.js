const nodemailer = require('nodemailer');
const logger = require('./logger');

/**
 * Envío de correos por SMTP (sirve con Gmail + contraseña de aplicación, Brevo, Resend, etc.).
 *
 * Variables: SMTP_HOST, SMTP_PORT (465 = TLS directo; 587 = STARTTLS), SMTP_USER, SMTP_PASS,
 * MAIL_FROM (p. ej. "LectorApp <no-responder@tudominio.cl>").
 *
 * - NODE_ENV=test: no envía nada; guarda los correos en `outbox` para que los tests los lean.
 * - Sin SMTP configurado fuera de producción: escribe el correo en el log (desarrollo local).
 * - Sin SMTP en producción: lo registra como error (el código no le llega al usuario).
 */
const outbox = [];
let transporter = null;

const isConfigured = () =>
    Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

function getTransporter() {
    if (!transporter) {
        const port = Number(process.env.SMTP_PORT || 465);
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port,
            secure: port === 465,
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        });
    }
    return transporter;
}

/** @param {{to: string, subject: string, text: string, html?: string}} mail */
async function sendMail(mail) {
    if (process.env.NODE_ENV === 'test') {
        outbox.push(mail);
        return;
    }
    if (!isConfigured()) {
        if (process.env.NODE_ENV === 'production') {
            logger.error({ to: mail.to, subject: mail.subject }, 'SMTP no configurado: correo NO enviado');
        } else {
            logger.warn({ to: mail.to, subject: mail.subject, text: mail.text }, 'SMTP no configurado (dev): correo solo en el log');
        }
        return;
    }
    await getTransporter().sendMail({
        from: process.env.MAIL_FROM || process.env.SMTP_USER,
        ...mail,
    });
}

module.exports = { sendMail, isConfigured, outbox };
