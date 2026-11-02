const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

process.env.MERCADOPAGO_WEBHOOK_SECRET = 'segredo-webhook';

const {
  prepararAmbiente,
  finalizarAmbiente,
  estoqueDe,
  aguardar,
  enviadosEmTeste,
  db
} = require('./ajuda');

const mercadoPago = require('../src/integracoes/mercadoPago');
const correios = require('../src/integracoes/correios');
const freteService = require('../src/services/freteService');
const pagamentosService = require('../src/services/pagamentosService');
const pedidosService = require('../src/services/pedidosService');

let api;
let ids;
let token;


/* =============================================================
   MERCADO PAGO SIMULADO
============================================================= */

let proximoPagamento = 1000;
const pagamentosMp = new Map();   // id -> { status, valor, pedido_id }
let falharCriacao = false;
const reembolsos = [];

mercadoPago.criarPix = async ({ pedidoId, valor }) => {
  if (falharCriacao) throw new Error('MP fora do ar');
  const id = String(proximoPagamento++);
  pagamentosMp.set(id, { status: 'pending', valor, pedido_id: pedidoId });
  return { id, status: 'pending', qr_code: `PIX-${id}`, qr_code_base64: 'aW1n', url: `https://mp.teste/${id}` };
};

mercadoPago.criarPreferencia = async ({ pedidoId }) => ({
  id: `pref-${pedidoId}`,
  url: `https://mp.teste/checkout/${pedidoId}`
});

/*
  buscarPagamento real, com fetch simulado: garante que respostas da
  API sem campos opcionais (status_detail etc.) não quebram o banco.
*/
const fetchOriginal = global.fetch;

global.fetch = async (url, opcoes) => {

  // Busca por referência do pedido (/v1/payments/search?external_reference=)
  const busca = String(url).match(/^https:\/\/api\.mercadopago\.com\/v1\/payments\/search\?(.*)$/);

  if (busca) {
    const referencia = new URLSearchParams(busca[1]).get('external_reference');
    const results = [...pagamentosMp]
      .filter(([, p]) => String(p.pedido_id) === referencia)
      .map(([id, p]) => ({ id: Number(id), external_reference: String(p.pedido_id) }));
    return new Response(JSON.stringify({ results }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  }

  const m = String(url).match(/^https:\/\/api\.mercadopago\.com\/v1\/payments\/(\d+)$/);

  if (!m) {
    return fetchOriginal(url, opcoes);
  }

  const p = pagamentosMp.get(m[1]);

  return new Response(JSON.stringify({
    id: Number(m[1]),
    status: p.status,
    transaction_amount: p.valor,
    transaction_amount_refunded: p.reembolsado || 0,
    external_reference: String(p.pedido_id),
    ...(p.tipo ? { payment_type_id: p.tipo } : {}),
    ...(p.vencimento ? { date_of_expiration: p.vencimento } : {})
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

process.env.MERCADOPAGO_ACCESS_TOKEN = 'TEST-token';

mercadoPago.reembolsar = async (id, valor) => {
  reembolsos.push({ id, valor });
  return { id: 'r1', valor, status: 'approved' };
};


function assinar(dataId, requestId = 'req-1') {
  const ts = String(Date.now());
  const manifesto = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = crypto.createHmac('sha256', 'segredo-webhook').update(manifesto).digest('hex');
  return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId };
}


before(async () => {
  ({ api, ids, tokenAdmin: token } = await prepararAmbiente());
});

after(async () => {
  await finalizarAmbiente(api);
});

beforeEach(async () => {
  falharCriacao = false;
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
    metodo_pagamento: 'pix',
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

test('checkout PIX cria pedido com frete e pagamento; acompanhamento por token', async () => {

  const corpo = checkout();
  const resposta = await api.post('/checkout', corpo);

  assert.equal(resposta.status, 201);
  assert.equal(resposta.dados.pedido.total, 125);
  assert.equal(resposta.dados.pagamento.metodo, 'pix');
  assert.ok(resposta.dados.pagamento.pix_qr_code.startsWith('PIX-'));
  assert.equal(resposta.dados.pedido.token_acesso.length, 64);

  const { id, token_acesso: tokenAcesso } = resposta.dados.pedido;

  const acompanhamento = await api.get(`/pedidos/${id}/acompanhar?token=${tokenAcesso}`);
  assert.equal(acompanhamento.status, 200);
  assert.equal(acompanhamento.dados.frete, 25);
  assert.equal(acompanhamento.dados.pagamento.metodo, 'pix');
  assert.equal(acompanhamento.dados.token_acesso, undefined);

  assert.equal((await api.get(`/pedidos/${id}/acompanhar?token=${'0'.repeat(64)}`)).status, 404);
  assert.equal((await api.get(`/pedidos/${id}/acompanhar`)).status, 404);

  // Mesmo número de caracteres, mas com acento (mais bytes): 404, não 500
  const comAcento = encodeURIComponent('é' + '0'.repeat(63));
  assert.equal((await api.get(`/pedidos/${id}/acompanhar?token=${comAcento}`)).status, 404);
  assert.equal((await api.post(`/pedidos/${id}/pagamento`, { token: 'é' + '0'.repeat(63), metodo_pagamento: 'pix' })).status, 404);

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

test('checkout exige forma de pagamento e Checkout Pro devolve link', async () => {

  assert.equal((await api.post('/checkout', checkout({ metodo_pagamento: 'dinheiro' }))).status, 400);

  const pro = await api.post('/checkout', checkout({ metodo_pagamento: 'mercadopago' }));
  assert.equal(pro.status, 201);
  assert.match(pro.dados.pagamento.url, /mp\.teste\/checkout/);
});

test('falha ao gerar pagamento mantém o pedido e permite tentar de novo', async () => {

  falharCriacao = true;

  const resposta = await api.post('/checkout', checkout());
  assert.equal(resposta.status, 201);
  assert.equal(resposta.dados.pagamento, null);
  assert.ok(resposta.dados.erro_pagamento);

  falharCriacao = false;

  const { id, token_acesso: tokenAcesso } = resposta.dados.pedido;

  const nova = await api.post(`/pedidos/${id}/pagamento`, { token: tokenAcesso, metodo_pagamento: 'pix' });
  assert.equal(nova.status, 201);
  assert.ok(nova.dados.pix_qr_code);

  assert.equal((await api.post(`/pedidos/${id}/pagamento`, { token: 'x', metodo_pagamento: 'pix' })).status, 404);
});

test('pedido sem cobrança gerada também expira e devolve o estoque', async () => {

  const antes = await estoqueDe(ids.variacaoPId);

  falharCriacao = true;
  const resposta = await api.post('/checkout', checkout());
  falharCriacao = false;

  const pedidoId = resposta.dados.pedido.id;
  assert.equal(await estoqueDe(ids.variacaoPId), antes - 1);

  // Antes da correção o prazo ficava NULL e o pedido nunca expirava
  const [[pedido]] = await db.query('SELECT pagamento_expira_em FROM pedidos WHERE id = ?', [pedidoId]);
  assert.ok(pedido.pagamento_expira_em);

  await db.query(
    'UPDATE pedidos SET pagamento_expira_em = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = ?',
    [pedidoId]
  );

  await pagamentosService.expirarPendentes();

  const expirado = await api.get(`/admin/pedidos/${pedidoId}`, { token });
  assert.equal(expirado.dados.status, 'cancelado');
  assert.equal(await estoqueDe(ids.variacaoPId), antes);
});


/* =============================================================
   WEBHOOK
============================================================= */

async function pedidoComPix() {
  const resposta = await api.post('/checkout', checkout());
  const [pagamento] = (await db.query(
    "SELECT provedor_id FROM pagamentos WHERE pedido_id = ? AND tipo = 'pagamento'",
    [resposta.dados.pedido.id]
  ))[0];
  return { pedidoId: resposta.dados.pedido.id, mpId: pagamento.provedor_id };
}

test('webhook com assinatura válida e pagamento aprovado marca o pedido como pago', async () => {

  const { pedidoId, mpId } = await pedidoComPix();
  pagamentosMp.get(mpId).status = 'approved';

  // Assinatura inválida: ignorado
  await api.post(`/pagamentos/webhook/mercadopago?type=payment&data.id=${mpId}`, { type: 'payment' }, {
    cabecalhos: { 'x-signature': 'ts=1,v1=errado', 'x-request-id': 'req-1' }
  });

  let pedido = await api.get(`/admin/pedidos/${pedidoId}`, { token });
  assert.equal(pedido.dados.status, 'aguardando_pagamento');

  const resposta = await api.post(`/pagamentos/webhook/mercadopago?type=payment&data.id=${mpId}`, { type: 'payment' }, {
    cabecalhos: assinar(mpId)
  });
  assert.equal(resposta.status, 200);

  pedido = await api.get(`/admin/pedidos/${pedidoId}`, { token });
  assert.equal(pedido.dados.status, 'pago');
  assert.equal(pedido.dados.pagamento_status, 'aprovado');
  assert.ok(pedido.dados.pago_em);
  assert.equal(pedido.dados.historico.at(-1).origem, 'pagamento');

  // Notificação repetida não altera nada
  await api.post(`/pagamentos/webhook/mercadopago?type=payment&data.id=${mpId}`, {}, { cabecalhos: assinar(mpId) });

  const eventos = (await db.query('SELECT assinatura_valida, resultado FROM pagamento_eventos WHERE recurso_id = ?', [mpId]))[0];
  assert.deepEqual(eventos.map(e => e.resultado), ['assinatura inválida', 'pedido pago', 'já processado']);
});

test('pagamento com valor menor que o pedido não aprova', async () => {

  const { pedidoId, mpId } = await pedidoComPix();
  Object.assign(pagamentosMp.get(mpId), { status: 'approved', valor: 1 });

  await api.post(`/pagamentos/webhook/mercadopago?type=payment&data.id=${mpId}`, {}, { cabecalhos: assinar(mpId) });

  const pedido = await api.get(`/admin/pedidos/${pedidoId}`, { token });
  assert.equal(pedido.dados.status, 'aguardando_pagamento');
  assert.equal(pedido.dados.pagamento_status, 'valor_divergente');
});


/* =============================================================
   EXPIRAÇÃO E REEMBOLSO
============================================================= */

test('pedido não pago no prazo é cancelado e devolve o estoque', async () => {

  const antes = await estoqueDe(ids.variacaoPId);
  const { pedidoId } = await pedidoComPix();
  assert.equal(await estoqueDe(ids.variacaoPId), antes - 1);

  // Pago no último minuto: não cancela
  const { pedidoId: pagoId, mpId } = await pedidoComPix();
  pagamentosMp.get(mpId).status = 'approved';

  await db.query(
    'UPDATE pedidos SET pagamento_expira_em = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id IN (?, ?)',
    [pedidoId, pagoId]
  );

  await pagamentosService.expirarPendentes();

  const expirado = await api.get(`/admin/pedidos/${pedidoId}`, { token });
  assert.equal(expirado.dados.status, 'cancelado');
  assert.equal(expirado.dados.motivo_cancelamento, 'Pagamento não confirmado no prazo');

  const pago = await api.get(`/admin/pedidos/${pagoId}`, { token });
  assert.equal(pago.dados.status, 'pago');

  assert.equal(await estoqueDe(ids.variacaoPId), antes - 1);
});

test('expiração não cancela pedido que foi pago no meio do caminho', async () => {

  const { pedidoId, mpId } = await pedidoComPix();
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
    pagamentosMp.get(mpId).status = 'approved';
    await api.post(`/pagamentos/webhook/mercadopago?type=payment&data.id=${mpId}`, {}, { cabecalhos: assinar(mpId) });
    return cancelarOriginal(id, opcoes);
  };

  try {
    assert.equal(await pagamentosService.expirarPendentes(), 0);
  } finally {
    pedidosService.cancelar = cancelarOriginal;
  }

  const pedido = await api.get(`/admin/pedidos/${pedidoId}`, { token });
  assert.equal(pedido.dados.status, 'pago');
  assert.equal(pedido.dados.pagamento_status, 'aprovado');
  assert.equal(await estoqueDe(ids.variacaoPId), antes);
});

test('pagamento aprovado logo depois da expiração fica marcado para reembolso', async () => {

  const { pedidoId, mpId } = await pedidoComPix();
  pagamentosMp.get(mpId).status = 'approved';

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
    resultado = await pagamentosService.sincronizar(mpId);
  } finally {
    pedidosService.avancarStatus = avancarOriginal;
  }

  assert.equal(resultado.resultado, 'aprovado após cancelamento');

  const pedido = await api.get(`/admin/pedidos/${pedidoId}`, { token });
  assert.equal(pedido.dados.status, 'cancelado');
  assert.equal(pedido.dados.pagamento_status, 'aprovado_apos_cancelamento');
});

/*
  Checkout Pro: o pagamento nasce no Mercado Pago e o banco só tem a
  preferência. Simula um cartão aprovado cujo webhook se perdeu.
*/
async function pedidoCheckoutProPagoSemWebhook() {
  const resposta = await api.post('/checkout', checkout({ metodo_pagamento: 'mercadopago' }));
  const pedidoId = resposta.dados.pedido.id;
  const mpId = String(proximoPagamento++);
  pagamentosMp.set(mpId, { status: 'approved', valor: resposta.dados.pedido.total, pedido_id: pedidoId });
  return { pedidoId, mpId };
}

test('Checkout Pro sem webhook: painel encontra o pagamento ao sincronizar', async () => {

  const { pedidoId, mpId } = await pedidoCheckoutProPagoSemWebhook();

  const sincronizacao = await api.post(`/admin/pedidos/${pedidoId}/pagamentos/sincronizar`, {}, { token });
  assert.equal(sincronizacao.status, 200);
  assert.deepEqual(sincronizacao.dados.resultados.map(r => r.pagamento), [mpId]);

  const pedido = await api.get(`/admin/pedidos/${pedidoId}`, { token });
  assert.equal(pedido.dados.status, 'pago');
});

test('Checkout Pro sem webhook: expiração confere no Mercado Pago e não cancela pedido pago', async () => {

  const { pedidoId: pagoId } = await pedidoCheckoutProPagoSemWebhook();

  // Outro pedido do Checkout Pro que realmente não foi pago
  const naoPago = await api.post('/checkout', checkout({ metodo_pagamento: 'mercadopago' }));
  const naoPagoId = naoPago.dados.pedido.id;

  await db.query(
    'UPDATE pedidos SET pagamento_expira_em = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id IN (?, ?)',
    [pagoId, naoPagoId]
  );

  await pagamentosService.expirarPendentes();

  assert.equal((await api.get(`/admin/pedidos/${pagoId}`, { token })).dados.status, 'pago');
  assert.equal((await api.get(`/admin/pedidos/${naoPagoId}`, { token })).dados.status, 'cancelado');
});

test('expiração não cancela se a consulta ao Mercado Pago falhar', async () => {

  const resposta = await api.post('/checkout', checkout({ metodo_pagamento: 'mercadopago' }));
  const pedidoId = resposta.dados.pedido.id;

  await db.query(
    'UPDATE pedidos SET pagamento_expira_em = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = ?',
    [pedidoId]
  );

  const buscarOriginal = mercadoPago.buscarPagamentosDoPedido;
  mercadoPago.buscarPagamentosDoPedido = async () => { throw new Error('MP fora do ar'); };

  try {
    await pagamentosService.expirarPendentes();
  } finally {
    mercadoPago.buscarPagamentosDoPedido = buscarOriginal;
  }

  // Sem saber se foi pago, o pedido continua aguardando (tenta de novo depois)
  assert.equal((await api.get(`/admin/pedidos/${pedidoId}`, { token })).dados.status, 'aguardando_pagamento');

  await pagamentosService.expirarPendentes();
  assert.equal((await api.get(`/admin/pedidos/${pedidoId}`, { token })).dados.status, 'cancelado');
});

test('reembolso: somente gerente; total cancela e devolve estoque', async () => {

  const { pedidoId, mpId } = await pedidoComPix();
  pagamentosMp.get(mpId).status = 'approved';
  await api.post(`/pagamentos/webhook/mercadopago?type=payment&data.id=${mpId}`, {}, { cabecalhos: assinar(mpId) });

  // Operador não reembolsa
  await api.post('/admin/usuarios', { nome: 'Op', email: 'op@teste.com', senha: 'Operador123', perfil: 'operador' }, { token });
  const tokenOperador = (await api.post('/admin/login', { email: 'op@teste.com', senha: 'Operador123' })).dados.token;
  assert.equal((await api.post(`/admin/pedidos/${pedidoId}/reembolso`, {}, { token: tokenOperador })).status, 403);

  const antes = await estoqueDe(ids.variacaoPId);

  // Parcial
  const parcial = await api.post(`/admin/pedidos/${pedidoId}/reembolso`, { valor: 10, motivo: 'Avaria' }, { token });
  assert.equal(parcial.status, 200);
  assert.equal(parcial.dados.status, 'reembolsado_parcial');

  let pedido = await api.get(`/admin/pedidos/${pedidoId}`, { token });
  assert.equal(pedido.dados.status, 'pago');

  // Restante, cancelando o pedido
  const cancelamento = await api.patch(`/admin/pedidos/${pedidoId}/cancelar`, { reembolsar: true }, { token });
  assert.equal(cancelamento.status, 200);
  assert.equal(cancelamento.dados.reembolso.valor_reembolsado, 115);

  pedido = await api.get(`/admin/pedidos/${pedidoId}`, { token });
  assert.equal(pedido.dados.status, 'cancelado');
  assert.equal(pedido.dados.valor_reembolsado, 125);
  assert.equal(await estoqueDe(ids.variacaoPId), antes + 1);

  assert.deepEqual(reembolsos.slice(-2).map(r => r.valor), [10, 115]);

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

test('Checkout Pro abandonado expira em 2 horas; boleto gerado mantém a reserva até compensar', async () => {

  // Abandonado: prazo de 2 horas (antes eram 3 dias)
  const abandonado = await api.post('/checkout', checkout({ metodo_pagamento: 'mercadopago' }));
  const [[pedidoAbandonado]] = await db.query(
    'SELECT TIMESTAMPDIFF(MINUTE, NOW(), pagamento_expira_em) AS minutos FROM pedidos WHERE id = ?',
    [abandonado.dados.pedido.id]
  );
  assert.ok(pedidoAbandonado.minutos > 100 && pedidoAbandonado.minutos <= 120, String(pedidoAbandonado.minutos));

  // Boleto gerado, vence amanhã e ainda não foi pago
  const comBoleto = await api.post('/checkout', checkout({ metodo_pagamento: 'mercadopago' }));
  const boletoId = comBoleto.dados.pedido.id;
  const vencimento = new Date(Date.now() + 24 * 60 * 60 * 1000);
  pagamentosMp.set(String(proximoPagamento++), {
    status: 'pending', tipo: 'ticket', vencimento: vencimento.toISOString(),
    valor: comBoleto.dados.pedido.total, pedido_id: boletoId
  });

  await db.query(
    'UPDATE pedidos SET pagamento_expira_em = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id IN (?, ?)',
    [abandonado.dados.pedido.id, boletoId]
  );

  await pagamentosService.expirarPendentes();

  assert.equal((await api.get(`/admin/pedidos/${abandonado.dados.pedido.id}`, { token })).dados.status, 'cancelado');

  const pedidoBoleto = (await api.get(`/admin/pedidos/${boletoId}`, { token })).dados;
  assert.equal(pedidoBoleto.status, 'aguardando_pagamento');

  // Reserva vai até o vencimento + 3 dias de compensação
  const prazo = new Date(pedidoBoleto.pagamento_expira_em).getTime();
  const esperado = vencimento.getTime() + 3 * 24 * 60 * 60 * 1000;
  assert.ok(Math.abs(prazo - esperado) < 2000, `${new Date(prazo).toISOString()} != ${new Date(esperado).toISOString()}`);
});

test('boleto vencido há mais de 3 dias não segura o estoque', async () => {

  const resposta = await api.post('/checkout', checkout({ metodo_pagamento: 'mercadopago' }));
  const pedidoId = resposta.dados.pedido.id;

  pagamentosMp.set(String(proximoPagamento++), {
    status: 'pending', tipo: 'ticket',
    vencimento: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    valor: resposta.dados.pedido.total, pedido_id: pedidoId
  });

  await db.query(
    'UPDATE pedidos SET pagamento_expira_em = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = ?',
    [pedidoId]
  );

  await pagamentosService.expirarPendentes();

  assert.equal((await api.get(`/admin/pedidos/${pedidoId}`, { token })).dados.status, 'cancelado');
});


async function pedidoPago() {
  const { pedidoId, mpId } = await pedidoComPix();
  pagamentosMp.get(mpId).status = 'approved';
  await api.post(`/pagamentos/webhook/mercadopago?type=payment&data.id=${mpId}`, {}, { cabecalhos: assinar(mpId) });
  return pedidoId;
}

test('dois cliques simultâneos em reembolsar não devolvem o valor duas vezes', async () => {

  const pedidoId = await pedidoPago();
  const antes = reembolsos.length;

  // Mercado Pago lento: as duas requisições ficam "no meio" ao mesmo tempo
  const reembolsarOriginal = mercadoPago.reembolsar;
  mercadoPago.reembolsar = async (...args) => {
    await new Promise(resolve => setTimeout(resolve, 200));
    return reembolsarOriginal(...args);
  };

  let respostas;

  try {
    respostas = await Promise.all([
      api.post(`/admin/pedidos/${pedidoId}/reembolso`, { valor: 100 }, { token }),
      api.post(`/admin/pedidos/${pedidoId}/reembolso`, { valor: 100 }, { token })
    ]);
  } finally {
    mercadoPago.reembolsar = reembolsarOriginal;
  }

  // Total do pedido: 125. Só um reembolso de 100 cabe.
  assert.deepEqual(respostas.map(r => r.status).sort(), [200, 400]);
  assert.equal(reembolsos.length, antes + 1);

  const pedido = await api.get(`/admin/pedidos/${pedidoId}`, { token });
  assert.equal(pedido.dados.valor_reembolsado, 100);
});

test('cancelar e reembolsar pedido já enviado é recusado sem devolver o dinheiro', async () => {

  const pedidoId = await pedidoPago();

  for (const status of ['em_preparacao', 'enviado']) {
    await api.patch(`/admin/pedidos/${pedidoId}/status`, { status }, { token });
  }

  const antes = reembolsos.length;

  const resposta = await api.patch(`/admin/pedidos/${pedidoId}/cancelar`, { reembolsar: true }, { token });
  assert.equal(resposta.status, 409);
  assert.match(resposta.dados.mensagem, /Use "Reembolsar"/);
  assert.equal(reembolsos.length, antes);

  const pedido = await api.get(`/admin/pedidos/${pedidoId}`, { token });
  assert.equal(pedido.dados.status, 'enviado');
  assert.equal(pedido.dados.valor_reembolsado, 0);

  // O reembolso avulso continua disponível para pedido enviado
  const avulso = await api.post(`/admin/pedidos/${pedidoId}/reembolso`, {}, { token });
  assert.equal(avulso.status, 200);
  assert.equal((await api.get(`/admin/pedidos/${pedidoId}`, { token })).dados.status, 'enviado');
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
