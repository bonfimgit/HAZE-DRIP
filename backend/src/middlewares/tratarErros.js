const multer = require('multer');

const { ErroApp } = require('../utils/erros');
const logger = require('../utils/logger');

/*
  Tratamento centralizado de erros.
  A resposta traz "mensagem" e "erro" com o mesmo texto, porque
  partes do frontend leem um campo e partes leem o outro.
*/

function responder(res, status, mensagem, detalhes) {

  const corpo = {
    mensagem,
    erro: mensagem
  };

  if (detalhes) {
    corpo.detalhes = detalhes;
  }

  return res.status(status).json(corpo);
}


function rotaNaoEncontrada(req, res) {
  responder(res, 404, 'Rota não encontrada');
}


// eslint-disable-next-line no-unused-vars
function tratarErros(erro, req, res, next) {

  if (erro instanceof ErroApp) {
    return responder(res, erro.status, erro.message, erro.detalhes);
  }

  if (erro instanceof multer.MulterError) {
    return responder(
      res,
      400,
      erro.code === 'LIMIT_FILE_SIZE'
        ? 'A imagem deve ter no máximo 5 MB'
        : 'Erro ao enviar imagem'
    );
  }

  if (erro.type === 'entity.parse.failed') {
    return responder(res, 400, 'JSON inválido na requisição');
  }

  if (erro.type === 'entity.too.large') {
    return responder(res, 413, 'Requisição muito grande');
  }

  if (erro.status && erro.status < 500) {
    return responder(res, erro.status, erro.message);
  }

  logger.erro('Erro não tratado', {
    metodo: req.method,
    rota: req.originalUrl,
    erro: erro.message,
    stack: erro.stack
  });

  return responder(res, 500, 'Erro interno do servidor');
}


module.exports = {
  tratarErros,
  rotaNaoEncontrada
};
