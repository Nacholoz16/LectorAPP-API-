const AccountService = require('../../services/account.service');

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

module.exports = { acceptTerms, getStatus, deactivate, reactivate, deleteAccount };
