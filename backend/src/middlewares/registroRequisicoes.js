const logger = require('../utils/logger');

// Requisições mais lentas que isso geram aviso no log
const LENTA_MS = 1000;

/*
  Uma linha de log por requisição (método, rota, status, duração).
  Base para monitorar erros e lentidão no painel do Railway.
*/
function registroRequisicoes(req, res, next) {

  const inicio = process.hrtime.bigint();

  res.on('finish', () => {

    const duracao = Number(process.hrtime.bigint() - inicio) / 1e6;

    const dados = {
      metodo: req.method,
      // Sem query string: pode conter tokens
      rota: req.originalUrl.split('?')[0],
      status: res.statusCode,
      duracao_ms: Math.round(duracao)
    };

    if (res.statusCode >= 500) {
      logger.erro('Requisição com erro', dados);
    } else if (duracao > LENTA_MS) {
      logger.aviso('Requisição lenta', dados);
    } else if (req.path !== '/health') {
      logger.info('Requisição', dados);
    }
  });

  next();
}

module.exports = { registroRequisicoes };
