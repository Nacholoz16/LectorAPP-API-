const jwt = require('jsonwebtoken');
const UserModel = require('../../models/user.model');

const protect = async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            // Obtener el token del header "Bearer <token>"
            token = req.headers.authorization.split(' ')[1];

            // Verificar el token
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            // Buscar el usuario asociado al token (sin password)
            // Esto nos permite acceder a req.user.id en cualquier controlador protegido
            const user = await UserModel.findById(decoded.id);
            
            if (!user) {
                return res.status(401).json({ error: 'Usuario no encontrado con este token' });
            }

            req.user = user;
            next(); // Continuar al controlador
        } catch (error) {
            console.error(error);
            return res.status(401).json({ error: 'Token no autorizado o expirado' });
        }
    }

    if (!token) {
        return res.status(401).json({ error: 'No autorizado, falta token' });
    }
};

module.exports = { protect };