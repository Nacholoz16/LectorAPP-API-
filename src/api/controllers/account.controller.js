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

module.exports = { acceptTerms, getStatus, deactivate, reactivate };
