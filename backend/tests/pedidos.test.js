const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  prepararAmbiente,
  finalizarAmbiente,
  pedidoValido,
  estoqueDe,
  db
} = require('./ajuda');

let api;
let ids;
let token;

before(async () => {
  ({ api, ids, tokenAdmin: token } = await prepararAmbiente());
});

after(async () => {
  await finalizarAmbiente(api);
});


function item(variacaoId, quantidade) {
  return { produto_id: ids.produtoId, variacao_id: variacaoId, quantidade };
}


test('cria pedido com preço do banco, baixa estoque e registra histórico', async () => {

  const corpo = pedidoValido([item(ids.variacaoPId, 2)]);
  corpo.subtotal = 1; // valor enviado pelo cliente é ignorado

  const resposta = await api.post('/pedidos', corpo);

  assert.equal(resposta.status, 201);
  assert.equal(resposta.dados.pedido.status, 'aguardando_pagamento');
  assert.equal(resposta.dados.pedido.subtotal, 200);
  assert.equal(resposta.dados.pedido.total, 200);

  assert.equal(await estoqueDe(ids.variacaoPId), 3);

  const detalhe = await api.get(`/admin/pedidos/${resposta.dados.pedido.id}`, { token });

  assert.equal(detalhe.dados.endereco_estado, 'MG');
  assert.equal(detalhe.dados.itens.length, 1);
  assert.equal(detalhe.dados.itens[0].produto_nome, 'Camiseta Haze');
  assert.equal(detalhe.dados.historico.length, 1);
  assert.equal(detalhe.dados.historico[0].status_novo, 'aguardando_pagamento');

  const [movimentacoes] = await db.query(
    'SELECT * FROM estoque_movimentacoes WHERE pedido_id = ?',
    [resposta.dados.pedido.id]
  );
  assert.equal(movimentacoes.length, 1);
  assert.equal(movimentacoes[0].tipo, 'venda');
  assert.equal(movimentacoes[0].quantidade, -2);
});

test('itens repetidos da mesma variação são somados (não deixa estoque negativo)', async () => {

  // Variação M tem 2 unidades: 2 + 2 = 4 deve ser recusado
  const resposta = await api.post('/pedidos', pedidoValido([
    item(ids.variacaoMId, 2),
    item(ids.variacaoMId, 2)
  ]));

  assert.equal(resposta.status, 409);
  assert.match(resposta.dados.erro, /Estoque insuficiente/);
  assert.equal(await estoqueDe(ids.variacaoMId), 2);
});

test('pedido falho não deixa nada gravado (transação)', async () => {

  const [antes] = await db.query('SELECT COUNT(*) AS total FROM pedidos');

  // Primeiro item válido, segundo sem estoque
  const resposta = await api.post('/pedidos', pedidoValido([
    item(ids.variacaoPId, 1),
    item(ids.variacaoMId, 50)
  ]));

  assert.equal(resposta.status, 409);

  const [depois] = await db.query('SELECT COUNT(*) AS total FROM pedidos');
  assert.equal(depois[0].total, antes[0].total);
  assert.equal(await estoqueDe(ids.variacaoPId), 3);
});

test('validações do pedido', async () => {

  const casos = [
    [{}, 'Dados do cliente são obrigatórios'],
    [{ ...pedidoValido([item(ids.variacaoPId, 1)]), cliente: { nome: 1, email: 'a@b.co', telefone: '35999999999' } }, null],
    [{ ...pedidoValido([item(ids.variacaoPId, 1)]), cliente: { nome: 'A', email: 'invalido', telefone: '35999999999' } }, 'E-mail inválido'],
    [{ ...pedidoValido([item(ids.variacaoPId, 1)]), cliente: { nome: 'A', email: 'a@b.co', telefone: '123' } }, 'Telefone inválido'],
    [pedidoValido([]), 'O pedido precisa possuir pelo menos um item'],
    [pedidoValido([item(0, 1)]), 'Item do pedido inválido'],
    [pedidoValido([item(ids.variacaoPId, 1.5)]), 'Item do pedido inválido'],
    [pedidoValido([item(ids.variacaoPId, 100)]), 'Quantidade máxima por item excedida']
  ];

  for (const [corpo, mensagem] of casos) {
    const resposta = await api.post('/pedidos', corpo);
    assert.equal(resposta.status, 400, JSON.stringify(corpo));
    if (mensagem) {
      assert.equal(resposta.dados.erro, mensagem);
    }
  }

  const cepInvalido = pedidoValido([item(ids.variacaoPId, 1)]);
  cepInvalido.endereco.cep = '123';
  assert.equal((await api.post('/pedidos', cepInvalido)).status, 400);

  const ufInvalida = pedidoValido([item(ids.variacaoPId, 1)]);
  ufInvalida.endereco.estado = 'M1';
  assert.equal((await api.post('/pedidos', ufInvalida)).status, 400);
});

test('produto inativo ou variação de outro produto não podem ser vendidos', async () => {

  await db.query('UPDATE produto_variacoes SET ativo = FALSE WHERE id = ?', [ids.variacaoMId]);

  const inativa = await api.post('/pedidos', pedidoValido([item(ids.variacaoMId, 1)]));
  assert.equal(inativa.status, 400);

  await db.query('UPDATE produto_variacoes SET ativo = TRUE WHERE id = ?', [ids.variacaoMId]);

  const outroProduto = await api.post('/pedidos', pedidoValido([
    { produto_id: 999, variacao_id: ids.variacaoPId, quantidade: 1 }
  ]));
  assert.equal(outroProduto.status, 404);
});

test('pedidos simultâneos não vendem além do estoque', async () => {

  // Variação M: 2 unidades. 5 pedidos de 1 unidade ao mesmo tempo.
  const respostas = await Promise.all(
    Array.from({ length: 5 }, () =>
      api.post('/pedidos', pedidoValido([item(ids.variacaoMId, 1)]))
    )
  );

  const criados = respostas.filter(r => r.status === 201).length;
  const recusados = respostas.filter(r => r.status === 409).length;

  assert.equal(criados, 2);
  assert.equal(recusados, 3);
  assert.equal(await estoqueDe(ids.variacaoMId), 0);
});

test('fluxo de status segue a ordem e grava datas e histórico', async () => {

  await db.query('UPDATE produto_variacoes SET estoque = 10 WHERE id = ?', [ids.variacaoPId]);

  const criado = await api.post('/pedidos', pedidoValido([item(ids.variacaoPId, 1)]));
  const pedidoId = criado.dados.pedido.id;

  const pulando = await api.patch(`/admin/pedidos/${pedidoId}/status`, { status: 'enviado' }, { token });
  assert.equal(pulando.status, 409);
  assert.match(pulando.dados.mensagem, /próximo status deve ser: pago/);

  for (const status of ['pago', 'em_preparacao']) {
    const resposta = await api.patch(`/admin/pedidos/${pedidoId}/status`, { status }, { token });
    assert.equal(resposta.status, 200);
    assert.equal(resposta.dados.pedido.status, status);
  }

  const enviado = await api.patch(`/admin/pedidos/${pedidoId}/status`, {
    status: 'enviado',
    codigo_rastreio: 'BR123',
    transportadora: 'Correios',
    url_rastreio: 'https://rastreio.teste/BR123'
  }, { token });
  assert.equal(enviado.status, 200);

  const cancelarEnviado = await api.patch(`/admin/pedidos/${pedidoId}/cancelar`, undefined, { token });
  assert.equal(cancelarEnviado.status, 409);

  await api.patch(`/admin/pedidos/${pedidoId}/status`, { status: 'entregue' }, { token });

  const final = await api.patch(`/admin/pedidos/${pedidoId}/status`, { status: 'pago' }, { token });
  assert.equal(final.status, 409);

  const detalhe = await api.get(`/admin/pedidos/${pedidoId}`, { token });

  assert.equal(detalhe.dados.status, 'entregue');
  assert.equal(detalhe.dados.codigo_rastreio, 'BR123');
  assert.ok(detalhe.dados.pago_em);
  assert.ok(detalhe.dados.enviado_em);
  assert.ok(detalhe.dados.entregue_em);
  assert.deepEqual(
    detalhe.dados.historico.map(h => h.status_novo),
    ['aguardando_pagamento', 'pago', 'em_preparacao', 'enviado', 'entregue']
  );
  assert.equal(detalhe.dados.historico[1].admin_nome, 'Gerente Teste');
});

test('cancelamento devolve estoque uma única vez', async () => {

  const antes = await estoqueDe(ids.variacaoPId);

  const criado = await api.post('/pedidos', pedidoValido([item(ids.variacaoPId, 3)]));
  const pedidoId = criado.dados.pedido.id;

  assert.equal(await estoqueDe(ids.variacaoPId), antes - 3);

  const cancelado = await api.patch(
    `/admin/pedidos/${pedidoId}/cancelar`,
    { motivo: 'Cliente desistiu' },
    { token }
  );
  assert.equal(cancelado.status, 200);
  assert.equal(await estoqueDe(ids.variacaoPId), antes);

  const deNovo = await api.patch(`/admin/pedidos/${pedidoId}/cancelar`, undefined, { token });
  assert.equal(deNovo.status, 409);
  assert.equal(await estoqueDe(ids.variacaoPId), antes);

  const alterar = await api.patch(`/admin/pedidos/${pedidoId}/status`, { status: 'pago' }, { token });
  assert.equal(alterar.status, 409);

  const detalhe = await api.get(`/admin/pedidos/${pedidoId}`, { token });
  assert.equal(detalhe.dados.motivo_cancelamento, 'Cliente desistiu');
  assert.ok(detalhe.dados.cancelado_em);
});

test('listagem de pedidos com filtros', async () => {

  const todos = await api.get('/admin/pedidos', { token });
  assert.equal(todos.status, 200);
  assert.ok(todos.dados.length >= 3);

  const cancelados = await api.get('/admin/pedidos?status=cancelado', { token });
  assert.ok(cancelados.dados.every(p => p.status === 'cancelado'));

  const busca = await api.get('/admin/pedidos?busca=cliente@teste', { token });
  assert.equal(busca.dados.length, todos.dados.length);

  assert.equal((await api.get('/admin/pedidos?status=xyz', { token })).status, 400);
  assert.equal((await api.get('/admin/pedidos/9999', { token })).status, 404);
});
