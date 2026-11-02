const crypto = require('crypto');
const { Router } = require('express');

const db = require('../../config/db');
const valida = require('../../utils/validacao');
const { naoEncontrado, muitasRequisicoes, requisicaoInvalida } = require('../../utils/erros');
const { identificarCliente } = require('../../middlewares/autenticacao');
const { criarLimitador } = require('../../middlewares/limiteTentativas');
const { lerDadosEntrega } = require('./pedidos');
const checkoutService = require('../../services/checkoutService');
const pedidosService = require('../../services/pedidosService');
const pagamentosService = require('../../services/pagamentosService');

const router = Router();


/*
  Limite de pedidos criados por IP (padrão: 10 por hora).
  Sem isso, um script podia abrir dezenas de pedidos com e-mails
  falsos e segurar o estoque da loja até cada um expirar.
  Conta só pedidos realmente criados: reenvio com a mesma chave de
  idempotência e tentativas recusadas (estoque, cupom) não contam.
*/
const limitePedidos = criarLimitador({
  maximo: () => Number(process.env.CHECKOUT_LIMITE_POR_HORA) || 10,
  janelaMs: 60 * 60 * 1000
});

router.limitePedidos = limitePedidos;


function lerCupom(valor) {
  return valida.texto(valor, 'Cupom inválido', { max: 40, opcional: true });
}


// Código do serviço dos Correios escolhido (PAC, SEDEX...)
function lerServicoFrete(valor) {
  return valida.texto(valor, 'Opção de frete inválida', { max: 10, opcional: true });
}


/* =============================================================
   COTAÇÃO E FINALIZAÇÃO
============================================================= */

router.post('/checkout/cotacao', identificarCliente, async (req, res) => {

  const { itens, cep, estado, cupom, email, servico_frete: servicoFrete } = req.body || {};

  res.json(await checkoutService.cotar({
    itens,
    cep: cep ? valida.cep(cep) : null,
    uf: estado ? valida.uf(estado) : null,
    cupom: lerCupom(cupom),
    servicoFrete: lerServicoFrete(servicoFrete),
    clienteId: req.cliente ? req.cliente.id : null,
    email: req.cliente ? req.cliente.email : (email ? valida.email(email) : null)
  }));
});


router.post('/checkout', identificarCliente, async (req, res) => {

  const corpo = req.body || {};

  if (limitePedidos.bloqueado(req.ip)) {
    throw muitasRequisicoes(
      'Você fez muitos pedidos em pouco tempo. Aguarde um pouco ou fale com o atendimento.'
    );
  }

  const { cliente, endereco } = await lerDadosEntrega(corpo, req.cliente);

  /*
    Cliente logado: o pedido usa sempre o e-mail da conta.
    Antes valia o e-mail digitado no formulário: o pedido aparecia em
    "Meus pedidos", mas os e-mails (pagamento, rastreio) iam para outro
    endereço, e o limite de cupom por cliente podia ser contornado.
  */
  if (req.cliente) {
    cliente.email = req.cliente.email;
  }

  const chave = corpo.chave_idempotencia == null
    ? null
    : valida.texto(corpo.chave_idempotencia, 'Chave de idempotência inválida', { max: 64, min: 16 });

  const resultado = await checkoutService.finalizar({
    cliente,
    endereco,
    itens: corpo.itens,
    clienteId: req.cliente ? req.cliente.id : null,
    cupom: lerCupom(corpo.cupom),
    servicoFrete: lerServicoFrete(corpo.servico_frete),
    metodoPagamento: corpo.metodo_pagamento,
    chaveIdempotencia: chave
  });

  if (!resultado.repetido) {
    limitePedidos.registrarFalha(req.ip); // conta o pedido criado
  }

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

  /*
    Compara os bytes, não a quantidade de caracteres: um token com
    acento tem o mesmo .length em caracteres mas mais bytes, e o
    timingSafeEqual lançava exceção (erro 500 em vez de 404).
  */
  const recebido = typeof token === 'string' ? Buffer.from(token) : null;
  const correto = esperado ? Buffer.from(esperado) : null;

  const valido =
    recebido &&
    correto &&
    recebido.length === correto.length &&
    crypto.timingSafeEqual(recebido, correto);

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


/*
  Volta do Checkout Pro (página do pedido com ?payment_id=...).
  Confirma o pagamento na hora, sem depender do webhook.
*/
router.post('/pedidos/:id/pagamento/confirmar', async (req, res) => {

  const pedidoId = valida.id(req.params.id, 'ID do pedido inválido');

  await pedidoPorToken(pedidoId, req.body?.token);

  const pagamentoId = String(req.body?.payment_id ?? '');

  if (!/^\d{1,30}$/.test(pagamentoId)) {
    throw requisicaoInvalida('Pagamento inválido');
  }

  const { resultado } = await pagamentosService.confirmarRetorno(pedidoId, pagamentoId);

  res.json({ resultado, pagamento: await pagamentosService.resumo(pedidoId) });
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
