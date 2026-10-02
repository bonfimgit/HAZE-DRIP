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
const pagamentosService = require('../src/services/pagamentosService');

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

mercadoPago.buscarPagamento = async id => {
  const p = pagamentosMp.get(String(id));
  return {
    id: String(id),
    status: p.status,
    status_detalhe: null,
    valor: p.valor,
    valor_reembolsado: p.reembolsado || 0,
    metodo: 'pix',
    tipo: 'bank_transfer',
    pedido_id: p.pedido_id
  };
};

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
