const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const {
  prepararAmbiente,
  finalizarAmbiente,
  estoqueDe,
  aguardar,
  enviadosEmTeste,
  db
} = require('./ajuda');

const config = require('../src/config/ambiente');
const correios = require('../src/integracoes/correios');
const freteService = require('../src/services/freteService');
const pagamentosService = require('../src/services/pagamentosService');
const pedidosService = require('../src/services/pedidosService');

let api;
let ids;
let token;


/* =============================================================
   INFINITEPAY SIMULADA

   O código real (integracoes/infinitePay.js) roda de verdade; só o
   fetch para a API da InfinitePay é respondido aqui, imitando o
   Checkout Integrado: POST /links e POST /payment_check.
============================================================= */

process.env.INFINITEPAY_API_URL = 'https://infinitepay.teste';
process.env.INFINITEPAY_API_KEY = 'inchk_chave_de_teste';
process.env.INFINITEPAY_HANDLE = 'hazedrip';

const linksIp = new Map();       // order_nsu -> { corpo, slug }
const transacoesIp = new Map();  // transaction_nsu -> { order_nsu, slug, amount, capture_method, installments }
const chamadasIp = [];           // { caminho, cabecalhos, corpo }
let proximaTransacao = 1;
let proximaFatura = 1;
let falharCriacao = false;
let falharVerificacao = false;

const fetchOriginal = global.fetch;

const json = (status, dados) =>
  new Response(JSON.stringify(dados), { status, headers: { 'Content-Type': 'application/json' } });

global.fetch = async (url, opcoes = {}) => {

  const m = String(url).match(/^https:\/\/infinitepay\.teste(\/links|\/payment_check)$/);

  if (!m) {
    return fetchOriginal(url, opcoes);
  }

  const caminho = m[1];
  const corpo = JSON.parse(opcoes.body || '{}');
  chamadasIp.push({ caminho, cabecalhos: opcoes.headers, corpo });

  if (opcoes.headers?.['X-Api-Key'] !== 'inchk_chave_de_teste') {
    return json(401, { message: 'invalid api key' });
  }

  if (caminho === '/links') {

    if (falharCriacao) {
      return json(503, { message: 'indisponível' });
    }

    const slug = `fatura-${proximaFatura++}`;
    linksIp.set(corpo.order_nsu, { corpo, slug });
    return json(200, { url: `https://checkout.infinitepay.teste/hazedrip/${slug}`, slug });
  }

  // /payment_check
  if (falharVerificacao) {
    return json(503, { message: 'indisponível' });
  }

  const transacao = transacoesIp.get(corpo.transaction_nsu);
  const confere = Boolean(
    transacao &&
    corpo.handle === 'hazedrip' &&
    transacao.order_nsu === corpo.order_nsu &&
    transacao.slug === corpo.slug
  );

  // Como a InfinitePay: dados que não batem voltam 200 com paid = false
  return json(200, {
    success: confere,
    paid: confere,
    amount: confere ? transacao.amount : 0,
    paid_amount: confere ? transacao.amount : 0,
    installments: confere ? transacao.installments : 0,
    capture_method: confere ? transacao.capture_method : null
  });
};


before(async () => {
  ({ api, ids, tokenAdmin: token } = await prepararAmbiente());
});

after(async () => {
  global.fetch = fetchOriginal;
  await finalizarAmbiente(api);
});

beforeEach(async () => {
  falharCriacao = false;
  falharVerificacao = false;
  await db.query('UPDATE produto_variacoes SET estoque = 50');
});


const ENDERECO = {
  cep: '01000-000', rua: 'Rua A', numero: '1', bairro: 'Centro', cidade: 'São Paulo', estado: 'SP'
};

function checkout(extra = {}) {
  return {
    cliente: { nome: 'Ana Compradora', email: 'ana@teste.com', telefone: '35999998888' },
    endereco: ENDERECO,
    itens: [{ produto_id: ids.produtoId, variacao_id: ids.variacaoPId, quantidade: 1 }],
    metodo_pagamento: 'infinitepay',
    chave_idempotencia: crypto.randomUUID(),
    ...extra
  };
}


/* =============================================================
   FRETE
============================================================= */

test('frete: regra padrão, frete grátis e regra mais específica', async () => {

  const itens = [{ variacao_id: ids.variacaoPId, quantidade: 1 }];

  let cotacao = await api.post('/checkout/cotacao', { itens, cep: '37900000', estado: 'MG' });
  assert.equal(cotacao.status, 200);
  assert.equal(cotacao.dados.subtotal, 100);
  assert.equal(cotacao.dados.frete.valor, 25);
  assert.equal(cotacao.dados.total, 125);

  // R$ 300: ainda abaixo do mínimo para frete grátis (R$ 399)
  cotacao = await api.post('/checkout/cotacao', {
    itens: [{ variacao_id: ids.variacaoPId, quantidade: 3 }], cep: '37900000', estado: 'MG'
  });
  assert.equal(cotacao.dados.frete.valor, 25);
  assert.equal(cotacao.dados.frete.gratis, false);

  // R$ 500: frete grátis

  cotacao = await api.post('/checkout/cotacao', {
    itens: [{ variacao_id: ids.variacaoPId, quantidade: 4 }, { variacao_id: ids.variacaoMId, quantidade: 1 }], cep: '37900000', estado: 'MG'
  });
  assert.equal(cotacao.dados.frete.gratis, true);
  assert.equal(cotacao.dados.total, 500);

  // Regras por UF e por faixa de CEP
  await api.post('/admin/frete', { nome: 'Minas', uf: 'MG', valor: 15, prazo_min_dias: 2, prazo_max_dias: 4 }, { token });
  await api.post('/admin/frete', { nome: 'Passos', cep_inicio: '37900-000', cep_fim: '37999-999', valor: 8, prazo_min_dias: 1, prazo_max_dias: 2 }, { token });

  cotacao = await api.post('/checkout/cotacao', { itens, cep: '37900000', estado: 'MG' });
  assert.equal(cotacao.dados.frete.descricao, 'Passos');
  assert.equal(cotacao.dados.frete.valor, 8);

  cotacao = await api.post('/checkout/cotacao', { itens, cep: '30100000', estado: 'MG' });
  assert.equal(cotacao.dados.frete.descricao, 'Minas');

  cotacao = await api.post('/checkout/cotacao', { itens, cep: '01000000', estado: 'SP' });
  assert.equal(cotacao.dados.frete.descricao, 'Entrega padrão');

  // "Calcular frete" da sacola manda só o CEP: o estado vem da faixa do CEP
  cotacao = await api.post('/checkout/cotacao', { itens, cep: '30130-010' });
  assert.equal(cotacao.dados.frete.descricao, 'Minas');
  assert.equal(cotacao.dados.total, 115);

  cotacao = await api.post('/checkout/cotacao', { itens, cep: '01310-100' });
  assert.equal(cotacao.dados.frete.descricao, 'Entrega padrão');

  const invalida = await api.post('/admin/frete', { nome: 'X', cep_inicio: '37900000', valor: 1, prazo_min_dias: 1, prazo_max_dias: 1 }, { token });
  assert.equal(invalida.status, 400);
});


/* =============================================================
   FRETE PELOS CORREIOS
============================================================= */

const VARIAVEIS_CORREIOS = {
  CORREIOS_USUARIO: 'loja',
  CORREIOS_CODIGO_ACESSO: 'codigo',
  CORREIOS_CARTAO_POSTAGEM: '0071234567',
  CORREIOS_CEP_ORIGEM: '37900-000'
};

async function comCorreios(cotarSimulado, executar) {

  const cotarOriginal = correios.cotar;
  Object.assign(process.env, VARIAVEIS_CORREIOS);
  correios.cotar = cotarSimulado;
  freteService.limparCacheCorreios();

  try {
    await executar();
  } finally {
    for (const nome of Object.keys(VARIAVEIS_CORREIOS)) delete process.env[nome];
    correios.cotar = cotarOriginal;
    freteService.limparCacheCorreios();
  }
}

test('frete pelos Correios: opções, escolha do serviço, frete grátis e pedido', async () => {

  const consultas = [];

  await comCorreios(async consulta => {
    consultas.push(consulta);
    return [
      { codigo: '03220', nome: 'SEDEX', valor: 41.9, prazo_dias: 2 },
      { codigo: '03298', nome: 'PAC', valor: 22.5, prazo_dias: 6 }
    ];
  }, async () => {

    const itens = [{ variacao_id: ids.variacaoPId, quantidade: 2 }];

    // Sem escolha: a mais barata, com o dia de postagem somado ao prazo
    let cotacao = await api.post('/checkout/cotacao', { itens, cep: '01000-000', estado: 'SP' });
    assert.equal(cotacao.status, 200);
    assert.equal(cotacao.dados.frete.origem, 'correios');
    assert.equal(cotacao.dados.frete.descricao, 'Correios PAC');
    assert.equal(cotacao.dados.frete.valor, 22.5);
    assert.equal(cotacao.dados.frete.prazo_max_dias, 7);
    assert.deepEqual(cotacao.dados.frete.opcoes.map(o => o.nome), ['PAC', 'SEDEX']);
    assert.equal(cotacao.dados.total, 222.5);

    // Pacote: 2 peças x 300 g, CEP só com números
    assert.equal(consultas[0].cepDestino, '01000000');
    assert.equal(consultas[0].pesoGramas, 600);

    // Mesma consulta de novo: vem do cache
    await api.post('/checkout/cotacao', { itens, cep: '01000000', estado: 'SP' });
    assert.equal(consultas.length, 1);

    cotacao = await api.post('/checkout/cotacao', { itens, cep: '01000000', estado: 'SP', servico_frete: '03220' });
    assert.equal(cotacao.dados.frete.descricao, 'Correios SEDEX');
    assert.equal(cotacao.dados.frete.valor, 41.9);

    // Acima de R$ 399 (regra da tabela): PAC grátis, SEDEX continua pago
    const grandes = [{ variacao_id: ids.variacaoPId, quantidade: 4 }, { variacao_id: ids.variacaoMId, quantidade: 1 }];
    cotacao = await api.post('/checkout/cotacao', { itens: grandes, cep: '01000000', estado: 'SP' });
    assert.equal(cotacao.dados.frete.gratis, true);
    assert.equal(cotacao.dados.frete.valor, 0);
    assert.equal(cotacao.dados.frete.opcoes.find(o => o.nome === 'SEDEX').valor, 41.9);

    // O pedido grava o serviço escolhido
    const resposta = await api.post('/checkout', checkout({ servico_frete: '03220' }));
    assert.equal(resposta.status, 201);
    assert.equal(resposta.dados.pedido.total, 141.9);

    const [[pedido]] = await db.query(
      'SELECT frete, frete_descricao, frete_prazo_min, frete_prazo_max FROM pedidos WHERE id = ?',
      [resposta.dados.pedido.id]
    );
    assert.equal(Number(pedido.frete), 41.9);
    assert.equal(pedido.frete_descricao, 'Correios SEDEX');
    assert.equal(pedido.frete_prazo_max, 3);
  });
});

test('Correios fora do ar: o frete cai na tabela', async () => {

  await comCorreios(async () => {
    throw new Error('Correios (preço PAC) respondeu 503');
  }, async () => {

    const cotacao = await api.post('/checkout/cotacao', {
      itens: [{ variacao_id: ids.variacaoPId, quantidade: 1 }], cep: '01000000', estado: 'SP'
    });

    assert.equal(cotacao.dados.frete.origem, 'tabela');
    assert.equal(cotacao.dados.frete.descricao, 'Entrega padrão');
    assert.equal(cotacao.dados.frete.valor, 25);
  });
});

test('cliente dos Correios: token reaproveitado e valores no formato brasileiro', async () => {

  const chamadas = [];
  const fetchAnterior = global.fetch;

  global.fetch = async (url, opcoes = {}) => {

    const endereco = new URL(String(url));
    chamadas.push({ caminho: endereco.pathname, parametros: endereco.searchParams, opcoes });

    const json = dados => new Response(JSON.stringify(dados), { status: 200 });

    if (endereco.pathname === '/token/v1/autentica/cartaopostagem') {
      return json({ token: 'tk-1', expiraEm: new Date(Date.now() + 3600 * 1000).toISOString() });
    }
    if (endereco.pathname === '/preco/v1/nacional/03298') return json({ pcFinal: '1.234,56' });
    if (endereco.pathname === '/prazo/v1/nacional/03298') return json({ prazoEntrega: 5 });
    if (endereco.pathname === '/preco/v1/nacional/03220') {
      return new Response(JSON.stringify({ msgs: ['Serviço não disponível no contrato'] }), { status: 400 });
    }
    return json({ prazoEntrega: 1 });
  };

  Object.assign(process.env, VARIAVEIS_CORREIOS);
  correios.limparToken();

  try {

    const consulta = { cepDestino: '01000000', pesoGramas: 600, comprimentoCm: 30, larguraCm: 20, alturaCm: 10 };

    // SEDEX recusado não derruba a cotação: só o PAC volta
    const opcoes = await correios.cotar(consulta);
    assert.deepEqual(opcoes, [{ codigo: '03298', nome: 'PAC', valor: 1234.56, prazo_dias: 5 }]);

    await correios.cotar(consulta);

    const tokens = chamadas.filter(c => c.caminho.startsWith('/token'));
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].opcoes.headers.Authorization, `Basic ${Buffer.from('loja:codigo').toString('base64')}`);
    assert.equal(JSON.parse(tokens[0].opcoes.body).numero, '0071234567');

    const preco = chamadas.find(c => c.caminho === '/preco/v1/nacional/03298');
    assert.equal(preco.opcoes.headers.Authorization, 'Bearer tk-1');
    assert.equal(preco.parametros.get('cepOrigem'), '37900000');
    assert.equal(preco.parametros.get('psObjeto'), '600');

  } finally {
    global.fetch = fetchAnterior;
    for (const nome of Object.keys(VARIAVEIS_CORREIOS)) delete process.env[nome];
    correios.limparToken();
  }
});


/* =============================================================
   CUPONS
============================================================= */

test('cupons: percentual, fixo, frete grátis, mínimo e validade', async () => {

  const criar = corpo => api.post('/admin/cupons', corpo, { token });

  assert.equal((await criar({ codigo: 'dez', tipo: 'percentual', valor: 10 })).status, 201);
  assert.equal((await criar({ codigo: 'DEZ', tipo: 'percentual', valor: 10 })).status, 409);
  await criar({ codigo: 'MENOS30', tipo: 'fixo', valor: 30, valor_minimo: 150 });
  await criar({ codigo: 'FRETEOFF', tipo: 'frete_gratis' });
  await criar({ codigo: 'VENCIDO', tipo: 'percentual', valor: 50, fim_em: '2020-01-01T00:00:00Z' });

  const itens = [{ variacao_id: ids.variacaoPId, quantidade: 2 }];
  const cotar = cupom => api.post('/checkout/cotacao', { itens, cep: '01000000', estado: 'SP', cupom });

  let c = await cotar('dez');
  assert.equal(c.dados.desconto, 20);
  assert.equal(c.dados.total, 200 - 20 + 25);

  c = await cotar('MENOS30');
  assert.equal(c.dados.desconto, 30);

  c = await cotar('FRETEOFF');
  assert.equal(c.dados.frete.valor, 0);

  c = await cotar('VENCIDO');
  assert.equal(c.dados.desconto, 0);
  assert.equal(c.dados.erro_cupom, 'Este cupom expirou');

  c = await api.post('/checkout/cotacao', { itens: [{ variacao_id: ids.variacaoPId, quantidade: 1 }], cep: '01000000', estado: 'SP', cupom: 'MENOS30' });
  assert.match(c.dados.erro_cupom, /a partir de/);

  c = await cotar('NAOEXISTE');
  assert.equal(c.dados.erro_cupom, 'Cupom inválido');
});

test('cupom com limite total não é usado além do limite, mesmo em paralelo', async () => {

  await api.post('/admin/cupons', { codigo: 'UNICO', tipo: 'fixo', valor: 5, limite_uso_total: 1 }, { token });

  const respostas = await Promise.all([1, 2, 3].map(i =>
    api.post('/checkout', checkout({
      cupom: 'UNICO',
      cliente: { nome: 'C', email: `c${i}@teste.com`, telefone: '35999998888' }
    }))
  ));

  assert.equal(respostas.filter(r => r.status === 201).length, 1);
  assert.equal(respostas.filter(r => r.status === 400).length, 2);

  const [cupom] = (await db.query("SELECT usos FROM cupons WHERE codigo = 'UNICO'"))[0];
  assert.equal(cupom.usos, 1);

  // Cancelar o pedido libera o uso
  const pedidoId = respostas.find(r => r.status === 201).dados.pedido.id;
  await api.patch(`/admin/pedidos/${pedidoId}/cancelar`, {}, { token });

  const [depois] = (await db.query("SELECT usos FROM cupons WHERE codigo = 'UNICO'"))[0];
  assert.equal(depois.usos, 0);
});

test('cupom com limite por cliente', async () => {

  await api.post('/admin/cupons', { codigo: 'PRIMEIRA', tipo: 'fixo', valor: 5, limite_por_cliente: 1 }, { token });

  const cliente = { nome: 'Bia', email: 'bia@teste.com', telefone: '35999998888' };

  assert.equal((await api.post('/checkout', checkout({ cupom: 'PRIMEIRA', cliente }))).status, 201);

  const segunda = await api.post('/checkout', checkout({ cupom: 'PRIMEIRA', cliente }));
  assert.equal(segunda.status, 400);
  assert.match(segunda.dados.mensagem, /máximo de vezes/);
});


/* =============================================================
   CHECKOUT, IDEMPOTÊNCIA E ACOMPANHAMENTO
============================================================= */

// Links de pagamento (order_nsu) criados para o pedido, do mais antigo ao mais novo
async function linksDoPedido(pedidoId) {
  const [linhas] = await db.query(
    "SELECT provedor_id FROM pagamentos WHERE pedido_id = ? AND tipo = 'link' ORDER BY id",
    [pedidoId]
  );
  return linhas.map(l => l.provedor_id);
}

async function pedidoComLink(extra) {
  const resposta = await api.post('/checkout', checkout(extra));
  const { id: pedidoId, token_acesso: tokenAcesso, total } = resposta.dados.pedido;
  const [orderNsu] = await linksDoPedido(pedidoId);
  return { pedidoId, tokenAcesso, orderNsu, total };
}

/*
  Cliente paga o link na InfinitePay. Devolve o que a InfinitePay
  manda de volta (URL de retorno e webhook).
*/
function pagar(orderNsu, { valor, metodo = 'pix', parcelas = 1 } = {}) {
  const link = linksIp.get(orderNsu);
  const transaction_nsu = `tx-${proximaTransacao++}`;
  const amount = valor != null ? Math.round(valor * 100) : link.corpo.items[0].price;
  transacoesIp.set(transaction_nsu, { order_nsu: orderNsu, slug: link.slug, amount, capture_method: metodo, installments: parcelas });
  return {
    order_nsu: orderNsu,
    transaction_nsu,
    slug: link.slug,
    receipt_url: `https://recibo.infinitepay.teste/${transaction_nsu}`,
    capture_method: metodo
  };
}

// Corpo do webhook no formato da InfinitePay (pagamento aprovado)
const webhook = (transacao, extra = {}) =>
  api.post('/pagamentos/webhook/infinitepay', {
    invoice_slug: transacao.slug,
    amount: 12500,
    paid_amount: 12500,
    installments: 1,
    capture_method: transacao.capture_method,
    transaction_nsu: transacao.transaction_nsu,
    order_nsu: transacao.order_nsu,
    receipt_url: transacao.receipt_url,
    items: [],
    ...extra
  });

async function resultadoEvento(transactionNsu) {
  const [eventos] = await db.query(
    'SELECT resultado FROM pagamento_eventos WHERE recurso_id = ? ORDER BY id', [transactionNsu]
  );
  return eventos.map(e => e.resultado);
}

const statusDo = async pedidoId => (await api.get(`/admin/pedidos/${pedidoId}`, { token })).dados;


test('checkout cria pedido e link de pagamento da InfinitePay; acompanhamento por token', async () => {

  const corpo = checkout();
  const resposta = await api.post('/checkout', corpo);

  assert.equal(resposta.status, 201);
  assert.equal(resposta.dados.pedido.total, 125);
  assert.equal(resposta.dados.pagamento.metodo, 'infinitepay');
  assert.match(resposta.dados.pagamento.url, /^https:\/\/checkout\.infinitepay\.teste\//);
  assert.equal(resposta.dados.pedido.token_acesso.length, 64);

  const { id, token_acesso: tokenAcesso } = resposta.dados.pedido;

  // O que a loja mandou para a InfinitePay
  const chamada = chamadasIp.filter(c => c.caminho === '/links').at(-1);
  assert.equal(chamada.cabecalhos['X-Api-Key'], 'inchk_chave_de_teste');
  assert.equal(chamada.corpo.handle, 'hazedrip');
  assert.match(chamada.corpo.order_nsu, new RegExp(`^${id}-[a-z0-9]+$`));
  assert.deepEqual(chamada.corpo.items, [{ quantity: 1, price: 12500, description: `Pedido #${id} — Haze Drip` }]);
  assert.equal(chamada.corpo.redirect_url, `http://loja.teste/pedido-confirmado.html?pedido=${id}&token=${tokenAcesso}`);
  assert.deepEqual(chamada.corpo.customer, { name: 'Ana Compradora', email: 'ana@teste.com' });
  assert.equal(chamada.corpo.options.single_payment, true);
  assert.deepEqual(chamada.corpo.options.payment_methods_enabled, ['credit_card', 'pix']);
  assert.equal(chamada.corpo.options.assured_installments, 1);
  // API em http (teste): sem webhook; em produção vai o endereço https
  assert.equal(chamada.corpo.webhook_url, undefined);

  // Link vale 60 min; o pedido só expira 10 min depois (folga)
  const minutosLink = (new Date(chamada.corpo.options.valid_until) - Date.now()) / 60000;
  assert.ok(minutosLink > 58 && minutosLink <= 60, String(minutosLink));
  const [[{ minutos }]] = await db.query(
    'SELECT TIMESTAMPDIFF(MINUTE, NOW(), pagamento_expira_em) AS minutos FROM pedidos WHERE id = ?', [id]
  );
  assert.ok(minutos >= 68 && minutos <= 70, String(minutos));

  const acompanhamento = await api.get(`/pedidos/${id}/acompanhar?token=${tokenAcesso}`);
  assert.equal(acompanhamento.status, 200);
  assert.equal(acompanhamento.dados.frete, 25);
  assert.equal(acompanhamento.dados.pagamento.url, resposta.dados.pagamento.url);
  assert.equal(acompanhamento.dados.token_acesso, undefined);

  assert.equal((await api.get(`/pedidos/${id}/acompanhar?token=${'0'.repeat(64)}`)).status, 404);
  assert.equal((await api.get(`/pedidos/${id}/acompanhar`)).status, 404);

  // Mesmo número de caracteres, mas com acento (mais bytes): 404, não 500
  const comAcento = encodeURIComponent('é' + '0'.repeat(63));
  assert.equal((await api.get(`/pedidos/${id}/acompanhar?token=${comAcento}`)).status, 404);
  assert.equal((await api.post(`/pedidos/${id}/pagamento`, { token: 'é' + '0'.repeat(63) })).status, 404);

  // Mesma chave: devolve o mesmo pedido
  const repetido = await api.post('/checkout', corpo);
  assert.equal(repetido.status, 200);
  assert.equal(repetido.dados.repetido, true);
  assert.equal(repetido.dados.pedido.id, id);

  // Mesma chave com outro e-mail: recusado
  const outro = await api.post('/checkout', { ...corpo, cliente: { ...corpo.cliente, email: 'outro@teste.com' } });
  assert.equal(outro.status, 409);

  // E-mail com link do pagamento
  await aguardar();
  assert.ok(enviadosEmTeste.some(e => e.assunto.includes(`Pedido #${id}`)));
});

test('webhook em endereço https é enviado para a InfinitePay', async () => {

  const original = config.urlApi;
  config.urlApi = 'https://api.hazedrip.teste';

  try {
    await api.post('/checkout', checkout());
  } finally {
    config.urlApi = original;
  }

  const chamada = chamadasIp.filter(c => c.caminho === '/links').at(-1);
  assert.equal(chamada.corpo.webhook_url, 'https://api.hazedrip.teste/pagamentos/webhook/infinitepay');
});

test('forma de pagamento: inválida é recusada; valores antigos (pix, mercadopago) viram InfinitePay', async () => {

  assert.equal((await api.post('/checkout', checkout({ metodo_pagamento: 'dinheiro' }))).status, 400);

  for (const antigo of ['pix', 'mercadopago', undefined]) {
    const resposta = await api.post('/checkout', checkout({ metodo_pagamento: antigo }));
    assert.equal(resposta.status, 201, String(antigo));
    assert.equal(resposta.dados.pagamento.metodo, 'infinitepay');
  }
});

test('falha ao gerar o link mantém o pedido e permite tentar de novo', async () => {

  falharCriacao = true;

  const resposta = await api.post('/checkout', checkout());
  assert.equal(resposta.status, 201);
  assert.equal(resposta.dados.pagamento, null);
  assert.ok(resposta.dados.erro_pagamento);

  falharCriacao = false;

  const { id, token_acesso: tokenAcesso } = resposta.dados.pedido;

  const nova = await api.post(`/pedidos/${id}/pagamento`, { token: tokenAcesso });
  assert.equal(nova.status, 201);
  assert.match(nova.dados.url, /infinitepay/);

  assert.equal((await api.post(`/pedidos/${id}/pagamento`, { token: 'x' })).status, 404);
});

test('InfinitePay sem chave configurada: pedido criado, pagamento indisponível', async () => {

  const chave = process.env.INFINITEPAY_API_KEY;
  delete process.env.INFINITEPAY_API_KEY;

  try {
    const resposta = await api.post('/checkout', checkout());
    assert.equal(resposta.status, 201);
    assert.equal(resposta.dados.pagamento, null);
    assert.ok(resposta.dados.erro_pagamento);
  } finally {
    process.env.INFINITEPAY_API_KEY = chave;
  }
});

test('pedido sem cobrança gerada também expira e devolve o estoque', async () => {

  const antes = await estoqueDe(ids.variacaoPId);

  falharCriacao = true;
  const resposta = await api.post('/checkout', checkout());
  falharCriacao = false;

  const pedidoId = resposta.dados.pedido.id;
  assert.equal(await estoqueDe(ids.variacaoPId), antes - 1);

  const [[pedido]] = await db.query('SELECT pagamento_expira_em FROM pedidos WHERE id = ?', [pedidoId]);
  assert.ok(pedido.pagamento_expira_em);

  await db.query(
    'UPDATE pedidos SET pagamento_expira_em = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = ?',
    [pedidoId]
  );

  await pagamentosService.expirarPendentes();

  assert.equal((await statusDo(pedidoId)).status, 'cancelado');
  assert.equal(await estoqueDe(ids.variacaoPId), antes);
});


/* =============================================================
   CONFIRMAÇÃO: VOLTA DO CLIENTE E WEBHOOK
============================================================= */

test('volta da InfinitePay confirma o pedido na hora', async () => {

  const { pedidoId, tokenAcesso, orderNsu } = await pedidoComLink();
  const rota = `/pedidos/${pedidoId}/pagamento/confirmar`;
  const transacao = pagar(orderNsu, { metodo: 'credit_card', parcelas: 3 });

  // Token errado ou dados com formato inválido
  assert.equal((await api.post(rota, { token: 'x', ...transacao })).status, 404);
  assert.equal((await api.post(rota, { token: tokenAcesso, ...transacao, slug: 'a b' })).status, 400);
  assert.equal((await api.post(rota, { token: tokenAcesso, ...transacao, order_nsu: 'xyz' })).status, 400);

  // Link de outro pedido não serve para este
  const outro = await pedidoComLink();
  const transacaoOutro = pagar(outro.orderNsu);
  assert.equal((await api.post(rota, { token: tokenAcesso, ...transacaoOutro })).status, 404);

  // Transação inventada (não existe na InfinitePay): não paga nada
  const inventada = await api.post(rota, { token: tokenAcesso, ...transacao, transaction_nsu: 'tx-falso' });
  assert.equal(inventada.status, 200);
  assert.equal(inventada.dados.resultado, 'não pago');
  assert.equal((await statusDo(pedidoId)).status, 'aguardando_pagamento');

  const confirmado = await api.post(rota, { token: tokenAcesso, ...transacao });
  assert.equal(confirmado.status, 200);
  assert.equal(confirmado.dados.resultado, 'pedido pago');
  // A página do pedido mostra o comprovante
  assert.equal(confirmado.dados.pagamento.url, transacao.receipt_url);

  const pedido = await statusDo(pedidoId);
  assert.equal(pedido.status, 'pago');
  assert.equal(pedido.pagamento_status, 'aprovado');
  assert.ok(pedido.pago_em);
  assert.match(pedido.historico.at(-1).observacao, /InfinitePay #tx-\d+ \(cartão 3x\)/);

  // Repetir (recarregar a página) não faz nada
  assert.equal((await api.post(rota, { token: tokenAcesso, ...transacao })).dados.resultado, 'já processado');

  // Painel: pagamentos do pedido
  const pagamentos = await api.get(`/admin/pedidos/${pedidoId}/pagamentos`, { token });
  const registrado = pagamentos.dados.find(p => p.tipo === 'pagamento');
  assert.equal(registrado.provedor, 'infinitepay');
  assert.equal(registrado.provedor_id, transacao.transaction_nsu);
  assert.equal(registrado.metodo, 'credit_card');
  assert.equal(registrado.valor, 125);
});

test('webhook só paga depois de confirmar na InfinitePay', async () => {

  const { pedidoId, orderNsu } = await pedidoComLink();
  const transacao = pagar(orderNsu);

  // Webhook falsificado (transação que não existe): não paga
  const falso = await webhook({ ...transacao, transaction_nsu: 'tx-falso' });
  assert.equal(falso.status, 200);
  assert.equal((await statusDo(pedidoId)).status, 'aguardando_pagamento');

  // Link que a loja nunca criou: ignorado
  await webhook({ ...transacao, order_nsu: '999999-abc' });

  // Dados incompletos: ignorado
  await webhook({ transaction_nsu: 'tx-incompleto' });

  const resposta = await webhook(transacao);
  assert.equal(resposta.status, 200);

  const pedido = await statusDo(pedidoId);
  assert.equal(pedido.status, 'pago');
  assert.equal(pedido.historico.at(-1).origem, 'pagamento');

  // Notificação repetida não altera nada
  await webhook(transacao);

  assert.deepEqual(await resultadoEvento('tx-falso'), ['não pago']);
  assert.deepEqual(await resultadoEvento(transacao.transaction_nsu), ['link desconhecido', 'pedido pago', 'já processado']);
  assert.deepEqual(await resultadoEvento('tx-incompleto'), ['dados incompletos']);

  const [[{ confirmado }]] = await db.query(
    "SELECT assinatura_valida AS confirmado FROM pagamento_eventos WHERE recurso_id = ? AND resultado = 'pedido pago'",
    [transacao.transaction_nsu]
  );
  assert.equal(Number(confirmado), 1);
});

test('InfinitePay fora do ar no webhook: responde erro para ser reenviado', async () => {

  const { pedidoId, orderNsu } = await pedidoComLink();
  const transacao = pagar(orderNsu);

  falharVerificacao = true;
  const resposta = await webhook(transacao);
  assert.equal(resposta.status, 503);
  assert.equal((await statusDo(pedidoId)).status, 'aguardando_pagamento');

  // Reenvio da InfinitePay
  falharVerificacao = false;
  assert.equal((await webhook(transacao)).status, 200);
  assert.equal((await statusDo(pedidoId)).status, 'pago');
});

test('pagamento com valor menor que o pedido não aprova', async () => {

  const { pedidoId, orderNsu } = await pedidoComLink();
  await webhook(pagar(orderNsu, { valor: 1 }));

  const pedido = await statusDo(pedidoId);
  assert.equal(pedido.status, 'aguardando_pagamento');
  assert.equal(pedido.pagamento_status, 'valor_divergente');
});


/* =============================================================
   EXPIRAÇÃO E REEMBOLSO
============================================================= */

test('pedido não pago no prazo é cancelado e devolve o estoque; pago não', async () => {

  const antes = await estoqueDe(ids.variacaoPId);
  const { pedidoId } = await pedidoComLink();

  const pago = await pedidoComLink();
  await webhook(pagar(pago.orderNsu));

  assert.equal(await estoqueDe(ids.variacaoPId), antes - 2);

  await db.query(
    'UPDATE pedidos SET pagamento_expira_em = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id IN (?, ?)',
    [pedidoId, pago.pedidoId]
  );

  await pagamentosService.expirarPendentes();

  const expirado = await statusDo(pedidoId);
  assert.equal(expirado.status, 'cancelado');
  assert.equal(expirado.motivo_cancelamento, 'Pagamento não confirmado no prazo');

  assert.equal((await statusDo(pago.pedidoId)).status, 'pago');
  assert.equal(await estoqueDe(ids.variacaoPId), antes - 1);
});

test('expiração não cancela pedido que foi pago no meio do caminho', async () => {

  const { pedidoId, orderNsu } = await pedidoComLink();
  const antes = await estoqueDe(ids.variacaoPId);

  await db.query(
    'UPDATE pedidos SET pagamento_expira_em = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = ?',
    [pedidoId]
  );

  /*
    Simula a corrida: a expiração já conferiu que o pedido estava
    aguardando, e o webhook aprova o pagamento logo antes do cancelamento.
  */
  const cancelarOriginal = pedidosService.cancelar;

  pedidosService.cancelar = async (id, opcoes) => {
    await webhook(pagar(orderNsu));
    return cancelarOriginal(id, opcoes);
  };

  try {
    assert.equal(await pagamentosService.expirarPendentes(), 0);
  } finally {
    pedidosService.cancelar = cancelarOriginal;
  }

  const pedido = await statusDo(pedidoId);
  assert.equal(pedido.status, 'pago');
  assert.equal(pedido.pagamento_status, 'aprovado');
  assert.equal(await estoqueDe(ids.variacaoPId), antes);
});

test('pagamento aprovado logo depois da expiração fica marcado para reembolso', async () => {

  const { pedidoId, orderNsu } = await pedidoComLink();
  const transacao = pagar(orderNsu);

  /*
    Simula a corrida inversa: o webhook leu o pedido como "aguardando"
    e a expiração o cancela antes de o webhook marcar como pago.
  */
  const avancarOriginal = pedidosService.avancarStatus;

  pedidosService.avancarStatus = async (id, status, opcoes) => {
    await pedidosService.cancelar(id, { origem: 'sistema', motivo: 'Pagamento não confirmado no prazo' });
    return avancarOriginal(id, status, opcoes);
  };

  let resultado;

  try {
    resultado = await pagamentosService.sincronizar({
      orderNsu: transacao.order_nsu, transactionNsu: transacao.transaction_nsu, slug: transacao.slug
    });
  } finally {
    pedidosService.avancarStatus = avancarOriginal;
  }

  assert.equal(resultado.resultado, 'aprovado após cancelamento');

  const pedido = await statusDo(pedidoId);
  assert.equal(pedido.status, 'cancelado');
  assert.equal(pedido.pagamento_status, 'aprovado_apos_cancelamento');
});

test('painel: sincronizar confere de novo os pagamentos registrados', async () => {

  const { pedidoId, orderNsu } = await pedidoComLink();
  const transacao = pagar(orderNsu);
  await webhook(transacao);

  const sincronizacao = await api.post(`/admin/pedidos/${pedidoId}/pagamentos/sincronizar`, {}, { token });
  assert.equal(sincronizacao.status, 200);
  assert.deepEqual(sincronizacao.dados.resultados.map(r => [r.pagamento, r.resultado]), [[transacao.transaction_nsu, 'já processado']]);

  // Pedido sem pagamento registrado: nada a conferir
  const semPagamento = await pedidoComLink();
  const vazio = await api.post(`/admin/pedidos/${semPagamento.pedidoId}/pagamentos/sincronizar`, {}, { token });
  assert.deepEqual(vazio.dados.resultados, []);
});

async function pedidoPago() {
  const { pedidoId, orderNsu } = await pedidoComLink();
  await webhook(pagar(orderNsu));
  return pedidoId;
}

test('reembolso registrado: somente gerente; total cancela e devolve estoque; nada é enviado à InfinitePay', async () => {

  const pedidoId = await pedidoPago();
  const chamadasAntes = chamadasIp.length;

  // Operador não reembolsa
  await api.post('/admin/usuarios', { nome: 'Op', email: 'op@teste.com', senha: 'Operador123', perfil: 'operador' }, { token });
  const tokenOperador = (await api.post('/admin/login', { email: 'op@teste.com', senha: 'Operador123' })).dados.token;
  assert.equal((await api.post(`/admin/pedidos/${pedidoId}/reembolso`, {}, { token: tokenOperador })).status, 403);

  const antes = await estoqueDe(ids.variacaoPId);

  // Parcial
  const parcial = await api.post(`/admin/pedidos/${pedidoId}/reembolso`, { valor: 10, motivo: 'Avaria' }, { token });
  assert.equal(parcial.status, 200);
  assert.equal(parcial.dados.status, 'reembolsado_parcial');
  assert.equal((await statusDo(pedidoId)).status, 'pago');

  // Restante, cancelando o pedido
  const cancelamento = await api.patch(`/admin/pedidos/${pedidoId}/cancelar`, { reembolsar: true }, { token });
  assert.equal(cancelamento.status, 200);
  assert.equal(cancelamento.dados.reembolso.valor_reembolsado, 115);

  const pedido = await statusDo(pedidoId);
  assert.equal(pedido.status, 'cancelado');
  assert.equal(pedido.valor_reembolsado, 125);
  assert.equal(await estoqueDe(ids.variacaoPId), antes + 1);

  // O estorno é feito no app da InfinitePay: a loja só registra
  assert.equal(chamadasIp.length, chamadasAntes);

  assert.equal((await api.post(`/admin/pedidos/${pedidoId}/reembolso`, {}, { token })).status, 409);
});


test('limite de pedidos criados por IP', async () => {

  const { limitePedidos } = require('../src/routes/loja/checkout');
  limitePedidos.limparTudo();
  process.env.CHECKOUT_LIMITE_POR_HORA = '2';

  try {

    const primeiro = checkout();
    assert.equal((await api.post('/checkout', primeiro)).status, 201);

    // Reenvio com a mesma chave (clique duplo) não conta
    assert.equal((await api.post('/checkout', primeiro)).status, 200);

    // Tentativa recusada (forma de pagamento inválida) não conta
    assert.equal((await api.post('/checkout', checkout({ metodo_pagamento: 'x' }))).status, 400);

    assert.equal((await api.post('/checkout', checkout())).status, 201);

    const bloqueado = await api.post('/checkout', checkout());
    assert.equal(bloqueado.status, 429);
    assert.match(bloqueado.dados.mensagem, /muitos pedidos/);

  } finally {
    process.env.CHECKOUT_LIMITE_POR_HORA = '100000';
    limitePedidos.limparTudo();
  }
});


/*
  Cliente gerou um segundo link (o primeiro "expirou" na tela) e pagou os dois.
*/
async function pedidoComDoisLinks() {
  const { pedidoId, tokenAcesso } = await pedidoComLink();
  await api.post(`/pedidos/${pedidoId}/pagamento`, { token: tokenAcesso });
  const [primeiro, segundo] = await linksDoPedido(pedidoId);
  return { pedidoId, transacao1: pagar(primeiro), transacao2: pagar(segundo) };
}

test('pedido pago duas vezes: duplicidade marcada e registrada como reembolsada sem cancelar o pedido', async () => {

  const { pedidoId, transacao1, transacao2 } = await pedidoComDoisLinks();

  await webhook(transacao1);
  await webhook(transacao2);
  await webhook(transacao2); // notificação repetida

  assert.deepEqual(await resultadoEvento(transacao2.transaction_nsu), ['pagamento duplicado', 'já processado']);

  let pedido = await statusDo(pedidoId);
  assert.equal(pedido.status, 'pago');
  assert.equal(pedido.pagamento_status, 'pagamento_duplicado');

  // "Cancelar e reembolsar" pede para resolver a duplicidade antes
  const cancelar = await api.patch(`/admin/pedidos/${pedidoId}/cancelar`, { reembolsar: true }, { token });
  assert.equal(cancelar.status, 409);
  assert.match(cancelar.dados.mensagem, /pago duas vezes/);

  // O reembolso registrado é o do pagamento duplicado; o pedido segue pago
  const reembolso = await api.post(`/admin/pedidos/${pedidoId}/reembolso`, {}, { token });
  assert.equal(reembolso.status, 200);
  assert.equal(reembolso.dados.duplicidade, true);

  const [[duplicado]] = await db.query(
    "SELECT status FROM pagamentos WHERE provedor_id = ? AND tipo = 'pagamento'", [transacao2.transaction_nsu]
  );
  assert.equal(duplicado.status, 'reembolsado');

  pedido = await statusDo(pedidoId);
  assert.equal(pedido.status, 'pago');
  assert.equal(pedido.pagamento_status, 'aprovado');
  assert.equal(pedido.valor_reembolsado, 0);
});

test('dois pagamentos aprovados ao mesmo tempo: um paga o pedido, o outro vira duplicidade', async () => {

  const { pedidoId, transacao1, transacao2 } = await pedidoComDoisLinks();

  await Promise.all([webhook(transacao1), webhook(transacao2)]);

  const resultados = [
    ...await resultadoEvento(transacao1.transaction_nsu),
    ...await resultadoEvento(transacao2.transaction_nsu)
  ].sort();
  assert.deepEqual(resultados, ['pagamento duplicado', 'pedido pago']);

  const pedido = await statusDo(pedidoId);
  assert.equal(pedido.status, 'pago');
  assert.equal(pedido.pagamento_status, 'pagamento_duplicado');
});


test('dois cliques simultâneos em reembolsar não registram o valor duas vezes', async () => {

  const pedidoId = await pedidoPago();

  const respostas = await Promise.all([
    api.post(`/admin/pedidos/${pedidoId}/reembolso`, { valor: 100 }, { token }),
    api.post(`/admin/pedidos/${pedidoId}/reembolso`, { valor: 100 }, { token })
  ]);

  // Total do pedido: 125. Só um reembolso de 100 cabe.
  assert.deepEqual(respostas.map(r => r.status).sort(), [200, 400]);
  assert.equal((await statusDo(pedidoId)).valor_reembolsado, 100);
});

test('cancelar e reembolsar pedido já enviado é recusado', async () => {

  const pedidoId = await pedidoPago();

  for (const status of ['em_preparacao', 'enviado']) {
    await api.patch(`/admin/pedidos/${pedidoId}/status`, { status }, { token });
  }

  const resposta = await api.patch(`/admin/pedidos/${pedidoId}/cancelar`, { reembolsar: true }, { token });
  assert.equal(resposta.status, 409);
  assert.match(resposta.dados.mensagem, /Use "Reembolsar"/);

  const pedido = await statusDo(pedidoId);
  assert.equal(pedido.status, 'enviado');
  assert.equal(pedido.valor_reembolsado, 0);

  // O reembolso avulso continua disponível para pedido enviado
  const avulso = await api.post(`/admin/pedidos/${pedidoId}/reembolso`, {}, { token });
  assert.equal(avulso.status, 200);
  assert.equal((await statusDo(pedidoId)).status, 'enviado');
});


/* =============================================================
   PROMOÇÕES
============================================================= */

test('promoção por campanha aplica desconto no período e volta ao normal depois', async () => {

  const form = new FormData();
  form.append('imagem', new Blob([Buffer.from('x')], { type: 'image/png' }), 'a.png');
  form.append('titulo', 'Black Haze');
  form.append('ativo', 'true');
  form.append('desconto_percentual', '20');
  form.append('produto_ids', String(ids.produtoId));
  form.append('fim_em', new Date(Date.now() + 3600000).toISOString());

  const campanha = await api.enviar('POST', '/admin/campanhas', form, { token });
  assert.equal(campanha.status, 201);
  assert.deepEqual(campanha.dados.campanha.produto_ids, [ids.produtoId]);

  const produto = await api.get(`/produtos/${ids.produtoId}`);
  assert.equal(produto.dados.preco, 80);
  assert.equal(produto.dados.preco_original, 100);

  const lista = await api.get('/produtos');
  assert.equal(lista.dados[0].preco, 80);

  const pedido = await api.post('/checkout', checkout());
  assert.equal(pedido.dados.pedido.subtotal, 80);

  const itens = (await db.query('SELECT preco_unitario, preco_original FROM pedidos_itens WHERE pedido_id = ?', [pedido.dados.pedido.id]))[0];
  assert.equal(Number(itens[0].preco_unitario), 80);
  assert.equal(Number(itens[0].preco_original), 100);

  // Fim do período: preço normal e banner some
  await db.query('UPDATE campanhas SET fim_em = DATE_SUB(NOW(), INTERVAL 1 MINUTE)');
  assert.equal((await api.get(`/produtos/${ids.produtoId}`)).dados.preco, 100);
  assert.equal((await api.get('/campanha')).status, 404);
});
