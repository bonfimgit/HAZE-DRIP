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
