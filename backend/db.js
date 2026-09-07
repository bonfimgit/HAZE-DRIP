//constante para carregar o .env
const{ loadEnvFile } = require('node:process');

try {
loadEnvFile();
} catch (erro) {
    if (erro.code !== 'ENOENT') {
        throw erro;
    }
}

//constante para carregar o mysql2
const mysql = require('mysql2');

//cria o objeto responsável por gerenciar as conexões entre nosso Node.js e o banco MySQL.
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});


module.exports = pool.promise();