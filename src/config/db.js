const mysql = require('mysql2');
require('dotenv').config();

// Lógica para elegir DB
const isTest = process.env.NODE_ENV === 'test';

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    // Si es test, usa la DB de test. Si no, la normal.
    database: isTest ? 'anti_social_test' : process.env.DB_NAME, 
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

module.exports = pool.promise();