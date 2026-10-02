const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { prepararAmbiente, finalizarAmbiente, db } = require('./ajuda');

let api;
let ids;

before(async () => {
  ({ api, ids } = await prepararAmbiente());
});

after(async () => {
  await finalizarAmbiente(api);
});


test('GET / e /health respondem', async () => {
  const raiz = await api.get('/');
  assert.equal(raiz.status, 200);

  const saude = await api.get('/health');
  assert.equal(saude.status, 200);
  assert.equal(saude.dados.banco, 'conectado');
});

test('lista somente produtos ativos com imagem principal', async () => {

  await db.query(
    `INSERT INTO produtos (nome, preco, categoria_id, ativo)
     VALUES ('Inativo', 50, ?, FALSE)`,
    [ids.categoriaId]
  );

  const resposta = await api.get('/produtos');

  assert.equal(resposta.status, 200);
  assert.equal(resposta.dados.length, 1);
  assert.equal(resposta.dados[0].nome, 'Camiseta Haze');
  assert.equal(resposta.dados[0].imagem_principal, 'https://cdn.teste/foto.jpg');
  assert.equal(resposta.dados[0].categoria_nome, 'Camisetas');
});

test('destaques retornam produtos com destaque_home', async () => {
  const resposta = await api.get('/produtos/destaques');
  assert.equal(resposta.status, 200);
  assert.equal(resposta.dados.length, 1);
});

test('detalhe do produto inclui imagens, variações e estoque total', async () => {

  const resposta = await api.get(`/produtos/${ids.produtoId}`);

  assert.equal(resposta.status, 200);
  assert.equal(resposta.dados.estoque_total, 7);
  assert.equal(resposta.dados.imagens.length, 1);
  assert.equal(resposta.dados.variacoes.length, 2);
});

test('produto inativo ou inexistente retorna 404', async () => {

  const [inativo] = await db.query(
    `INSERT INTO produtos (nome, preco, categoria_id, ativo)
     VALUES ('Outro inativo', 50, ?, FALSE)`,
    [ids.categoriaId]
  );

  assert.equal((await api.get(`/produtos/${inativo.insertId}`)).status, 404);
  assert.equal((await api.get('/produtos/99999')).status, 404);
  assert.equal((await api.get('/produtos/abc')).status, 400);
});

test('variações públicas, categorias e campanha', async () => {

  const variacoes = await api.get(`/produtos/${ids.produtoId}/variacoes`);
  assert.equal(variacoes.status, 200);
  assert.equal(variacoes.dados.length, 2);

  const categorias = await api.get('/categorias');
  assert.deepEqual(categorias.dados.map(c => c.nome), ['Camisetas']);

  const campanha = await api.get('/campanha');
  assert.equal(campanha.status, 404);
  assert.equal(campanha.dados.mensagem, 'Nenhuma campanha ativa');
});

test('rota inexistente e JSON inválido', async () => {

  assert.equal((await api.get('/nao-existe')).status, 404);

  const json = await api.post('/pedidos', '{x');
  assert.equal(json.status, 400);
  assert.equal(json.dados.mensagem, 'JSON inválido na requisição');
});

test('CORS bloqueia origem não permitida e libera a configurada', async () => {

  const bloqueada = await api.get('/produtos', {
    cabecalhos: { Origin: 'http://malicioso.teste' }
  });
  assert.equal(bloqueada.status, 403);

  const liberada = await api.get('/produtos', {
    cabecalhos: { Origin: 'http://loja.teste' }
  });
  assert.equal(liberada.status, 200);
  assert.equal(
    liberada.headers.get('access-control-allow-origin'),
    'http://loja.teste'
  );
});
