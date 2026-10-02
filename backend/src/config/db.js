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

module.exports = pool.promise();
