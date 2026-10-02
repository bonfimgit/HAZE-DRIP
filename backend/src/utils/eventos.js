/*
  Barramento de eventos interno.
  Serviços publicam eventos (ex.: pedido criado, status alterado)
  e módulos como o de e-mails se inscrevem, sem acoplamento direto.
*/

const { EventEmitter } = require('events');

const logger = require('./logger');

const eventos = new EventEmitter();

/*
  Executa os ouvintes de forma assíncrona e isolada:
  uma falha ao enviar e-mail nunca derruba a requisição.
*/
function publicar(nome, dados) {

  for (const ouvinte of eventos.listeners(nome)) {

    Promise.resolve()
      .then(() => ouvinte(dados))
      .catch(erro => {
        logger.erro('Erro em ouvinte de evento', {
          evento: nome,
          erro: erro.message
        });
      });
  }
}

function inscrever(nome, ouvinte) {
  eventos.on(nome, ouvinte);
}

module.exports = { publicar, inscrever };
