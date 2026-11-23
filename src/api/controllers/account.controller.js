const AccountService = require('../../services/account.service');
const DeletionRequestService = require('../../services/deletionRequest.service');

const acceptTerms = async (req, res) => {
    res.json(await AccountService.acceptTerms(req.user.id));
};

const getStatus = async (req, res) => {
    res.json(await AccountService.getStatus(req.user.id));
};

const deactivate = async (req, res) => {
    res.json(await AccountService.deactivate(req.user.id, req.body.password));
};

const reactivate = async (req, res) => {
    res.json(await AccountService.reactivate(req.user.id));
};

// 200 con cuerpo (no 204): el cliente confirma con `deleted: true` que el borrado ocurrió.
const deleteAccount = async (req, res) => {
    res.json(await AccountService.deleteAccount(req.user.id, req.body.password, req.token));
};

// --- Eliminar la cuenta desde la web, sin sesión (tarea 2.3) ---

// Misma respuesta exista o no la cuenta (y esté como esté): no revela qué emails están registrados.
const requestDeletion = async (req, res) => {
    await DeletionRequestService.requestDeletion(req.body);
    res.json({
        message: 'Si el email está registrado, te enviamos un código para confirmar. Revisa también la carpeta de spam.',
    });
};

const confirmDeletion = async (req, res) => {
    res.json(await DeletionRequestService.confirmDeletion(req.body));
};

module.exports = {
    acceptTerms,
    getStatus,
    deactivate,
    reactivate,
    deleteAccount,
    requestDeletion,
    confirmDeletion,
};
