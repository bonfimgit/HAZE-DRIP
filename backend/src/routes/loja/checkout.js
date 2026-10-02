const crypto = require('crypto');
const { Router } = require('express');

const db = require('../../config/db');
const valida = require('../../utils/validacao');
const { naoEncontrado } = require('../../utils/erros');
const { identificarCliente } = require('../../middlewares/autenticacao');
const { lerDadosEntrega } = require('./pedidos');
const checkoutService = require('../../services/checkoutService');
const pedidosService = require('../../services/pedidosService');
const pagamentosService = require('../../services/pagamentosService');

const router = Router();


function lerCupom(valor) {
  return valida.texto(valor, 'Cupom inválido', { max: 40, opcional: true });
}


/* =============================================================
   COTAÇÃO E FINALIZAÇÃO
============================================================= */

router.post('/checkout/cotacao', identificarCliente, async (req, res) => {

  const { itens, cep, estado, cupom, email } = req.body || {};

  res.json(await checkoutService.cotar({
    itens,
    cep: cep ? valida.cep(cep) : null,
    uf: estado ? valida.uf(estado) : null,
    cupom: lerCupom(cupom),
    clienteId: req.cliente ? req.cliente.id : null,
    email: req.cliente ? req.cliente.email : (email ? valida.email(email) : null)
  }));
});


router.post('/checkout', identificarCliente, async (req, res) => {

  const corpo = req.body || {};

  const { cliente, endereco } = await lerDadosEntrega(corpo, req.cliente);

  const chave = corpo.chave_idempotencia == null
    ? null
    : valida.texto(corpo.chave_idempotencia, 'Chave de idempotência inválida', { max: 64, min: 16 });

  const resultado = await checkoutService.finalizar({
    cliente,
    endereco,
    itens: corpo.itens,
    clienteId: req.cliente ? req.cliente.id : null,
    cupom: lerCupom(corpo.cupom),
    metodoPagamento: corpo.metodo_pagamento,
    chaveIdempotencia: chave
  });

  res.status(resultado.repetido ? 200 : 201).json({
    mensagem: 'Pedido criado com sucesso',
    ...resultado
  });
});


/* =============================================================
   ACOMPANHAMENTO SEM LOGIN (token do pedido)
============================================================= */

async function pedidoPorToken(pedidoId, token) {

  const [pedidos] = await db.execute(
    'SELECT token_acesso FROM pedidos WHERE id = ?',
    [pedidoId]
  );

  const esperado = pedidos[0]?.token_acesso;

  const valido =
    typeof token === 'string' &&
    esperado &&
    token.length === esperado.length &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(esperado));

  if (!valido) {
    throw naoEncontrado('Pedido não encontrado');
  }
}


router.get('/pedidos/:id/acompanhar', async (req, res) => {

  const pedidoId = valida.id(req.params.id, 'ID do pedido inválido');

  await pedidoPorToken(pedidoId, req.query.token);

  const pedido = await pedidosService.buscarCompleto(pedidoId);

  // Sem dados internos
  const {
    token_acesso: _token,
    chave_idempotencia: _chave,
    cliente_id: _cliente,
    ...publico
  } = pedido;

  publico.historico = pedido.historico.map(({ admin_nome: _admin, ...etapa }) => etapa);
  publico.pagamento = await pagamentosService.resumo(pedidoId);

  res.json(publico);
});


// Gera de novo o pagamento (PIX expirou, trocou de método, falha anterior)
router.post('/pedidos/:id/pagamento', async (req, res) => {

  const pedidoId = valida.id(req.params.id, 'ID do pedido inválido');

  await pedidoPorToken(pedidoId, req.body?.token);

  const metodo = valida.umDe(
    req.body?.metodo_pagamento,
    pagamentosService.METODOS,
    'Forma de pagamento inválida'
  );

  res.status(201).json(await pagamentosService.iniciar(pedidoId, metodo));
});


/* =============================================================
   WEBHOOK DO MERCADO PAGO
============================================================= */

router.post('/pagamentos/webhook/mercadopago', async (req, res) => {

  const tipo = req.query.type || req.query.topic || req.body?.type || null;
  const recursoId = req.query['data.id'] || req.body?.data?.id || req.query.id || null;

  await pagamentosService.processarWebhook({
    tipo,
    recursoId: recursoId ? String(recursoId).slice(0, 80) : null,
    assinatura: req.headers['x-signature'],
    requestId: req.headers['x-request-id']
  });

  // Sempre 200: o evento fica registrado em pagamento_eventos
  res.json({ recebido: true });
});


module.exports = router;
