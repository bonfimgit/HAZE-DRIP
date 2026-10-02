const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { prepararAmbiente, finalizarAmbiente, pedidoValido, db } = require('./ajuda');

let api;
let ids;
let token;

before(async () => {
  ({ api, ids, tokenAdmin: token } = await prepararAmbiente());

  const criar = async (variacaoId, quantidade, email) => {
    const corpo = pedidoValido([{ produto_id: ids.produtoId, variacao_id: variacaoId, quantidade }]);
    corpo.cliente.email = email;
    return (await api.post('/pedidos', corpo)).dados.pedido.id;
  };

  // 3 pedidos: 2 pagos (mesmo cliente = recorrente), 1 cancelado
  const a = await criar(ids.variacaoPId, 2, 'fiel@teste.com');
  const b = await criar(ids.variacaoPId, 1, 'fiel@teste.com');
  const c = await criar(ids.variacaoMId, 1, '=cmd|calc@teste.com');

  for (const id of [a, b]) {
    await api.patch(`/admin/pedidos/${id}/status`, { status: 'pago' }, { token });
  }

  await api.patch(`/admin/pedidos/${c}/cancelar`, {}, { token });

  // Reembolso parcial registrado em um pedido pago
  await db.query('UPDATE pedidos SET valor_reembolsado = 50 WHERE id = ?', [a]);
});

after(async () => {
  await finalizarAmbiente(api);
});


test('dashboard calcula vendas, ticket, cancelamentos e clientes', async () => {

  const resposta = await api.get('/admin/relatorios/dashboard', { token });
  assert.equal(resposta.status, 200);

  const { vendas, clientes, operacao } = resposta.dados;

  assert.equal(vendas.pedidos_criados, 3);
  assert.equal(vendas.pedidos_pagos, 2);
  assert.equal(vendas.pedidos_cancelados, 1);
  assert.equal(vendas.faturamento_bruto, 300);
  assert.equal(vendas.reembolsado, 50);
  assert.equal(vendas.faturamento, 250);
  assert.equal(vendas.ticket_medio, 150);
  assert.equal(vendas.conversao_pagamento, 66.67);
  assert.equal(vendas.taxa_cancelamento, 33.33);

  assert.equal(clientes.compradores, 1);
  assert.equal(clientes.recorrentes, 1);

  assert.equal(operacao.para_enviar, 2);

  assert.equal(resposta.dados.vendas_por_dia.length, 30);
  assert.equal(resposta.dados.vendas_por_dia.at(-1).faturamento, 300);

  assert.equal(resposta.dados.mais_vendidos[0].quantidade, 3);
  assert.equal(resposta.dados.categorias[0].categoria, 'Camisetas');
});

test('dashboard por período e validação de datas', async () => {

  const passado = await api.get('/admin/relatorios/dashboard?de=2020-01-01&ate=2020-01-31', { token });
  assert.equal(passado.status, 200);
  assert.equal(passado.dados.vendas.pedidos_criados, 0);
  assert.equal(passado.dados.vendas_por_dia.length, 31);

  assert.equal((await api.get('/admin/relatorios/dashboard?de=ontem', { token })).status, 400);
  assert.equal((await api.get('/admin/relatorios/dashboard?de=2020-02-01&ate=2020-01-01', { token })).status, 400);
  assert.equal((await api.get('/admin/relatorios/dashboard?de=2020-01-01&ate=2022-01-01', { token })).status, 400);
});

test('exportação CSV: formato Excel, proteção contra fórmula e permissão', async () => {

  const resposta = await api.get('/admin/relatorios/exportar/pedidos', { token });

  assert.equal(resposta.status, 200);
  assert.match(resposta.headers.get('content-type'), /text\/csv/);
  assert.match(resposta.headers.get('content-disposition'), /haze-drip-pedidos-/);

  const linhas = resposta.dados.replace(/^﻿/, '').split('\r\n');
  assert.equal(linhas.length, 4);
  assert.ok(linhas[0].startsWith('Pedido;Data;Status'));

  // E-mail começando com "=" não vira fórmula no Excel
  assert.ok(resposta.dados.includes("'=cmd|calc@teste.com"));
  assert.ok(resposta.dados.includes(';200;'));

  for (const tipo of ['itens', 'estoque', 'movimentacoes', 'clientes']) {
    const r = await api.get(`/admin/relatorios/exportar/${tipo}`, { token });
    assert.equal(r.status, 200, tipo);
  }

  assert.equal((await api.get('/admin/relatorios/exportar/senhas', { token })).status, 400);

  await api.post('/admin/usuarios', { nome: 'Op', email: 'op@teste.com', senha: 'Operador123', perfil: 'operador' }, { token });
  const tokenOperador = (await api.post('/admin/login', { email: 'op@teste.com', senha: 'Operador123' })).dados.token;

  assert.equal((await api.get('/admin/relatorios/exportar/pedidos', { token: tokenOperador })).status, 403);
  assert.equal((await api.get('/admin/relatorios/dashboard', { token: tokenOperador })).status, 200);
});
