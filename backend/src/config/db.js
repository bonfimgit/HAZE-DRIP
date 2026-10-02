const mysql = require('mysql2');

const config = require('./ambiente');

// Pool de conexões entre o Node.js e o MySQL
const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  // DECIMAL como número e datas como objeto Date
  decimalNumbers: true
});

/*
  Sessão do MySQL no mesmo fuso do Node: DATE(criado_em) e NOW()
  usam o dia de Brasília. Offset fixo: o Brasil não tem horário
  de verão desde 2019 e o MySQL pode não ter as tabelas de fuso.
*/
const OFFSET_BANCO = process.env.DB_TIMEZONE || '-03:00';

pool.on('connection', conexao => {
  conexao.query('SET time_zone = ?', [OFFSET_BANCO]);
});

module.exports = pool.promise();
