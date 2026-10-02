// Ponto de entrada da API Haze Drip.
// A aplicação fica em src/app.js; aqui só iniciamos o servidor.

const config = require('./src/config/ambiente');
const logger = require('./src/utils/logger');

if (!config.jwtSecret) {
  console.error('JWT_SECRET não definido. Configure o arquivo .env.');
  process.exit(1);
}

const db = require('./src/config/db');
const { criarApp } = require('./src/app');

const app = criarApp();

app.listen(config.porta, () => {
  logger.info('Servidor iniciado', { porta: config.porta });
});

db.query('SELECT 1')
  .then(() => logger.info('MySQL conectado'))
  .catch(erro => logger.erro('Erro ao conectar ao MySQL', { erro: erro.message }));
