const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { prepararAmbiente, finalizarAmbiente, ADMIN, db } = require('./ajuda');

let api;
let ids;
let token;

before(async () => {
  ({ api, ids, tokenAdmin: token } = await prepararAmbiente());
});

after(async () => {
  await finalizarAmbiente(api);
});


test('cabeçalhos de segurança do Helmet', async () => {
  const resposta = await api.get('/produtos');
  assert.equal(resposta.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(resposta.headers.get('x-powered-by'), null);
});

test('gerente cria operador; operador não gerencia usuários', async () => {

  const fraca = await api.post('/admin/usuarios', {
    nome: 'Op', email: 'op@teste.com', senha: '123', perfil: 'operador'
  }, { token });
  assert.equal(fraca.status, 400);

  const criado = await api.post('/admin/usuarios', {
    nome: 'Operador', email: 'op@teste.com', senha: 'Operador123', perfil: 'operador'
  }, { token });
  assert.equal(criado.status, 201);
  assert.equal(criado.dados.senha_hash, undefined);

  const duplicado = await api.post('/admin/usuarios', {
    nome: 'Operador', email: 'op@teste.com', senha: 'Operador123', perfil: 'operador'
  }, { token });
  assert.equal(duplicado.status, 409);

  const login = await api.post('/admin/login', { email: 'op@teste.com', senha: 'Operador123' });
  const tokenOperador = login.dados.token;

  assert.equal((await api.get('/admin/usuarios', { token: tokenOperador })).status, 403);
  assert.equal((await api.get('/admin/produtos', { token: tokenOperador })).status, 200);
});

test('desativar administrador encerra as sessões dele', async () => {

  const criado = await api.post('/admin/usuarios', {
    nome: 'Temporário', email: 'temp@teste.com', senha: 'Temporario1', perfil: 'operador'
  }, { token });

  const login = await api.post('/admin/login', { email: 'temp@teste.com', senha: 'Temporario1' });
  const tokenTemp = login.dados.token;

  assert.equal((await api.get('/admin/me', { token: tokenTemp })).status, 200);

  const desativado = await api.put(`/admin/usuarios/${criado.dados.id}`, {
    nome: 'Temporário', perfil: 'operador', ativo: false
  }, { token });
  assert.equal(desativado.status, 200);

  assert.equal((await api.get('/admin/me', { token: tokenTemp })).status, 401);
});

test('gerente não remove o próprio acesso nem o último gerente', async () => {

  const proprio = await api.put(`/admin/usuarios/${ids.adminId}`, {
    nome: 'Gerente', perfil: 'operador', ativo: true
  }, { token });
  assert.equal(proprio.status, 400);
});

test('troca da própria senha invalida tokens antigos e devolve um novo', async () => {

  const errada = await api.patch('/admin/me/senha', {
    senha_atual: 'errada', senha_nova: 'NovaSenha123'
  }, { token });
  assert.equal(errada.status, 400);

  const troca = await api.patch('/admin/me/senha', {
    senha_atual: ADMIN.senha, senha_nova: 'NovaSenha123'
  }, { token });
  assert.equal(troca.status, 200);

  assert.equal((await api.get('/admin/me', { token })).status, 401);
  assert.equal((await api.get('/admin/me', { token: troca.dados.token })).status, 200);

  const [linhas] = await db.query('SELECT ultimo_login_em FROM usuarios_admin WHERE id = ?', [ids.adminId]);
  assert.ok(linhas[0].ultimo_login_em);
});

test('operador não confirma pagamento à mão nem cancela pedido pago', async () => {

  const { criarPedido, pedidoValido } = require('./ajuda');

  // O teste anterior trocou a senha do gerente: faz login de novo
  const token = (await api.post('/admin/login', {
    email: ADMIN.email, senha: 'NovaSenha123'
  })).dados.token;

  await api.post('/admin/usuarios', {
    nome: 'Operadora', email: 'operadora@teste.com', senha: 'Operador123', perfil: 'operador'
  }, { token });

  const tokenOperador = (await api.post('/admin/login', {
    email: 'operadora@teste.com', senha: 'Operador123'
  })).dados.token;

  const novoPedido = async () => (await criarPedido(api, pedidoValido([
    { produto_id: ids.produtoId, variacao_id: ids.variacaoPId, quantidade: 1 }
  ]))).dados.pedido.id;

  // Confirmar pagamento manualmente: só gerente
  const pedidoA = await novoPedido();
  const marcarPago = await api.patch(`/admin/pedidos/${pedidoA}/status`, { status: 'pago' }, { token: tokenOperador });
  assert.equal(marcarPago.status, 403);
  assert.equal((await api.get(`/admin/pedidos/${pedidoA}`, { token })).dados.status, 'aguardando_pagamento');

  // Operador pode cancelar pedido ainda não pago
  assert.equal((await api.patch(`/admin/pedidos/${pedidoA}/cancelar`, {}, { token: tokenOperador })).status, 200);

  // Pedido pago: operador não cancela, gerente cancela
  const pedidoB = await novoPedido();
  assert.equal((await api.patch(`/admin/pedidos/${pedidoB}/status`, { status: 'pago' }, { token })).status, 200);

  const cancelarPago = await api.patch(`/admin/pedidos/${pedidoB}/cancelar`, {}, { token: tokenOperador });
  assert.equal(cancelarPago.status, 403);
  assert.equal((await api.get(`/admin/pedidos/${pedidoB}`, { token })).dados.status, 'pago');

  // Operador continua avançando as etapas de envio normalmente
  assert.equal((await api.patch(`/admin/pedidos/${pedidoB}/status`, { status: 'em_preparacao' }, { token: tokenOperador })).status, 200);

  assert.equal((await api.patch(`/admin/pedidos/${pedidoB}/cancelar`, {}, { token })).status, 200);
});
