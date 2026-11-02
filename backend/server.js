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

/*
  A cada 5 minutos cancela pedidos com pagamento vencido e devolve o
  estoque (confere no Mercado Pago antes de cancelar).
*/
const pagamentosService = require('./src/services/pagamentosService');

setInterval(() => {
  pagamentosService.expirarPendentes().catch(erro =>
    logger.erro('Erro na expiração de pedidos', { erro: erro.message })
  );
}, 5 * 60 * 1000).unref();

/*
  A cada minuto reenvia e-mails que falharam ou ficaram pela metade
  (ex.: servidor reiniciou durante o envio). Roda também ao iniciar.
*/
const emailService = require('./src/services/emailService');

function processarEmails() {
  emailService.processarFila().catch(erro =>
    logger.erro('Erro na fila de e-mails', { erro: erro.message })
  );
}

setInterval(processarEmails, 60 * 1000).unref();
setTimeout(processarEmails, 10 * 1000).unref();

db.query('SELECT 1')
  .then(() => logger.info('MySQL conectado'))
  .catch(erro => logger.erro('Erro ao conectar ao MySQL', { erro: erro.message }));
