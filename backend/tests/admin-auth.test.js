const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const { prepararAmbiente, finalizarAmbiente, ADMIN, db } = require('./ajuda');

let api;
let tokenAdmin;

before(async () => {
  ({ api, tokenAdmin } = await prepararAmbiente());
});

after(async () => {
  await finalizarAmbiente(api);
});


test('login devolve token e dados do usuário', async () => {

  const resposta = await api.post('/admin/login', {
    email: ADMIN.email.toUpperCase(),
    senha: ADMIN.senha
  });

  assert.equal(resposta.status, 200);
  assert.ok(resposta.dados.token);
  assert.equal(resposta.dados.usuario.email, ADMIN.email);
  assert.equal(resposta.dados.admin.nome, 'Gerente Teste');
  assert.equal(resposta.dados.usuario.senha_hash, undefined);
});

test('login valida campos', async () => {
  assert.equal((await api.post('/admin/login', {})).status, 400);
  assert.equal((await api.post('/admin/login', { email: 1, senha: 2 })).status, 400);
});

test('rotas administrativas exigem token válido', async () => {

  assert.equal((await api.get('/admin/produtos')).status, 401);

  assert.equal(
    (await api.get('/admin/produtos', { cabecalhos: { Authorization: 'Token x' } })).status,
    401
  );

  assert.equal((await api.get('/admin/produtos', { token: 'invalido' })).status, 401);

  const expirado = jwt.sign(
    { tipo: 'admin', id: 1 },
    process.env.JWT_SECRET,
    { expiresIn: -10 }
  );

  const resposta = await api.get('/admin/produtos', { token: expirado });
  assert.equal(resposta.status, 401);
  assert.equal(resposta.dados.mensagem, 'Token expirado');

  assert.equal((await api.get('/admin/produtos', { token: tokenAdmin })).status, 200);
});

test('token de cliente não acessa o painel', async () => {

  const tokenCliente = jwt.sign(
    { tipo: 'cliente', id: 1 },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  assert.equal((await api.get('/admin/produtos', { token: tokenCliente })).status, 401);
});

test('GET /admin/me devolve o administrador logado', async () => {
  const resposta = await api.get('/admin/me', { token: tokenAdmin });
  assert.equal(resposta.status, 200);
  assert.equal(resposta.dados.email, ADMIN.email);
});

test('bloqueia após 5 senhas erradas', async () => {

  const email = 'outro@teste.com';

  for (let i = 0; i < 5; i++) {
    const resposta = await api.post('/admin/login', { email, senha: 'errada' });
    assert.equal(resposta.status, 401);
  }

  const bloqueado = await api.post('/admin/login', { email, senha: 'errada' });
  assert.equal(bloqueado.status, 429);
});

test('ações de escrita do admin ficam na auditoria', async () => {

  await api.post('/categorias', { nome: 'Bonés' }, { token: tokenAdmin });

  // A auditoria é gravada após a resposta
  await new Promise(resolve => setTimeout(resolve, 100));

  const [linhas] = await db.query(
    "SELECT * FROM auditoria_admin WHERE rota = '/categorias'"
  );

  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].metodo, 'POST');
  assert.equal(linhas[0].admin_email, ADMIN.email);
});
