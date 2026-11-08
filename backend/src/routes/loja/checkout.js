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

/*
  Novos links de pagamento por pedido: no máximo 10 por hora.
  Quem tem o link do pedido (token) poderia gerar centenas de links
  na InfinitePay; o cliente de verdade precisa de um ou dois.
  Conta só links realmente criados.
*/
const limiteLinksPorPedido = criarLimitador({
  maximo: 10,
  janelaMs: 60 * 60 * 1000
});

router.limiteLinksPorPedido = limiteLinksPorPedido;


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


// Gera um novo link de pagamento (o anterior expirou ou falhou)
router.post('/pedidos/:id/pagamento', async (req, res) => {

  const pedidoId = valida.id(req.params.id, 'ID do pedido inválido');

  await pedidoPorToken(pedidoId, req.body?.token);

  const metodo = valida.umDe(
    pagamentosService.normalizarMetodo(req.body?.metodo_pagamento),
    pagamentosService.METODOS,
    'Forma de pagamento inválida'
  );

  // Limite de links por pedido (ver limiteLinksPorPedido acima)
  const chaveLimite = `pedido:${pedidoId}`;

  if (limiteLinksPorPedido.bloqueado(chaveLimite)) {
    throw muitasRequisicoes(
      'Muitos links de pagamento gerados para este pedido. Use o último link ou aguarde uma hora.'
    );
  }

  const pagamento = await pagamentosService.iniciar(pedidoId, metodo);

  limiteLinksPorPedido.registrarFalha(chaveLimite); // conta o link criado

  res.status(201).json(pagamento);
});


/*
  Volta da página da InfinitePay. A URL traz order_nsu,
  transaction_nsu e slug; a confirmação é feita na InfinitePay.
*/
router.post('/pedidos/:id/pagamento/confirmar', async (req, res) => {

  const pedidoId = valida.id(req.params.id, 'ID do pedido inválido');

  await pedidoPorToken(pedidoId, req.body?.token);

  const ler = (campo, padrao, max) => {
    const valor = String(req.body?.[campo] ?? '').trim();
    if (!padrao.test(valor) || valor.length > max) {
      throw requisicaoInvalida('Pagamento inválido');
    }
    return valor;
  };

  const { resultado } = await pagamentosService.confirmarRetorno(pedidoId, {
    orderNsu: ler('order_nsu', /^\d+-[a-z0-9]+$/, 80),
    transactionNsu: ler('transaction_nsu', /^[\w-]+$/, 80),
    slug: ler('slug', /^[\w-]+$/, 120),
    comprovante: /^https:\/\//.test(req.body?.receipt_url || '') ? String(req.body.receipt_url).slice(0, 500) : null
  });

  res.json({ resultado, pagamento: await pagamentosService.resumo(pedidoId) });
});


/* =============================================================
   WEBHOOK DA INFINITEPAY
============================================================= */

router.post('/pagamentos/webhook/infinitepay', async (req, res) => {

  const { resultado, tentarDeNovo } = await pagamentosService.processarWebhook(req.body || {});

  /*
    Falha ao confirmar na InfinitePay: responde erro para ela reenviar
    o aviso. Nos demais casos 200 (o evento fica em pagamento_eventos).
  */
  if (tentarDeNovo) {
    return res.status(503).json({ recebido: false });
  }

  res.json({ recebido: true, resultado });
});


module.exports = router;
