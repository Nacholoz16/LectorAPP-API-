const AccountService = require('../../services/account.service');

const acceptTerms = async (req, res) => {
    res.json(await AccountService.acceptTerms(req.user.id));
};

module.exports = { acceptTerms };
