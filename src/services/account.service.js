const UserModel = require('../models/user.model');
const { CURRENT_TERMS_VERSION, termsStatus } = require('../config/terms');
const { TermsRequiredError, UnauthorizedError } = require('../utils/errors');

/** Operaciones sobre la cuenta del usuario autenticado (`/api/account`). */
class AccountService {
    /**
     * Acepta la versión VIGENTE de los términos (el cliente no elige versión: solo se puede
     * aceptar la que está publicada). Idempotente: repetirla conserva la fecha original.
     */
    async acceptTerms(userId) {
        const row = await UserModel.acceptTerms(userId, CURRENT_TERMS_VERSION);
        // `protect` ya comprobó que el usuario existe; si se borró entre medio, la sesión no vale.
        if (!row) throw new UnauthorizedError('Usuario no encontrado con este token');
        return {
            ...termsStatus(row.terms_version),
            terms_accepted_at: row.terms_accepted_at,
        };
    }

    /**
     * Lanza 403 TERMS_REQUIRED si el usuario no aceptó la versión vigente. Se usa antes de
     * crear contenido público (lecturas públicas); el contenido privado no lo necesita.
     */
    async assertTermsAccepted(userId) {
        const version = await UserModel.getTermsVersion(userId);
        if (version !== CURRENT_TERMS_VERSION) throw new TermsRequiredError();
    }
}

module.exports = new AccountService();
