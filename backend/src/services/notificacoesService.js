/*
  Notificações por e-mail do ciclo de vida do pedido.
  Reage aos eventos publicados pelo pedidosService.
*/

const { inscrever } = require('../utils/eventos');
const emailService = require('./emailService');
const templates = require('../emails/templates');

let registrado = false;


async function enviarStatusPedido({ pedidoId }) {

  // require aqui evita dependência circular
  const pedidosService = require('./pedidosService');

  const pedido = await pedidosService.buscarCompleto(pedidoId);

  const mensagem = templates.statusPedido(pedido);

  await emailService.enviar({
    para: pedido.cliente_email,
    ...mensagem
  });
}


function registrar() {

  if (registrado) {
    return;
  }

  registrado = true;

  inscrever('pedido:criado', enviarStatusPedido);
  inscrever('pedido:status', enviarStatusPedido);
}


module.exports = { registrar };
