const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  prepararAmbiente,
  finalizarAmbiente,
  pedidoValido,
  cadastrarCliente,
  db
} = require('./ajuda');

let api;
let ids;
let token;
let moletomId;

before(async () => {

  ({ api, ids, tokenAdmin: token } = await prepararAmbiente());

  // Segundo produto: Moletom R$ 250, categoria Moletons, tamanho G Cinza
  const [categoria] = await db.query("INSERT INTO categorias (nome) VALUES ('Moletons')");
  const [moletom] = await db.query(
    `INSERT INTO produtos (nome, descricao, preco, categoria_id, ativo, criado_em)
     VALUES ('Moletom Fog', 'Felpado', 250, ?, TRUE, DATE_SUB(NOW(), INTERVAL 1 DAY))`,
    [categoria.insertId]
  );
  moletomId = moletom.insertId;
  await db.query(
    "INSERT INTO produto_variacoes (produto_id, tamanho, cor, estoque, sku) VALUES (?, 'G', 'Cinza', 3, 'MOL-G')",
    [moletomId]
  );

  // Produto sem estoque
  const [esgotado] = await db.query(
    `INSERT INTO produtos (nome, preco, categoria_id, ativo) VALUES ('Boné Esgotado', 80, ?, TRUE)`,
    [ids.categoriaId]
  );
  await db.query(
    "INSERT INTO produto_variacoes (produto_id, tamanho, cor, estoque, sku) VALUES (?, 'U', 'Preto', 0, 'BONE-U')",
    [esgotado.insertId]
  );
});

after(async () => {
  await finalizarAmbiente(api);
});


test('catálogo pagina, busca, filtra e ordena', async () => {

  let r = await api.get('/catalogo');
  assert.equal(r.status, 200);
  assert.equal(r.dados.total, 3);
  assert.match(r.headers.get('cache-control'), /max-age=60/);

  r = await api.get('/catalogo?limite=2&pagina=2&ordem=nome');
  assert.equal(r.dados.produtos.length, 1);
  assert.equal(r.dados.paginas, 2);
  assert.equal(r.dados.produtos[0].nome, 'Moletom Fog');

  r = await api.get('/catalogo?busca=felpado');
  assert.deepEqual(r.dados.produtos.map(p => p.nome), ['Moletom Fog']);

  r = await api.get('/catalogo?ordem=menor_preco');
  assert.deepEqual(r.dados.produtos.map(p => Number(p.preco)), [80, 100, 250]);

  r = await api.get('/catalogo?tamanho=G');
  assert.deepEqual(r.dados.produtos.map(p => p.nome), ['Moletom Fog']);

  r = await api.get('/catalogo?cor=Preto');
  assert.deepEqual(r.dados.produtos.map(p => p.nome), ['Camiseta Haze']);

  r = await api.get(`/catalogo?categoria=${ids.categoriaId}&disponivel=1`);
  assert.deepEqual(r.dados.produtos.map(p => p.nome), ['Camiseta Haze']);

  r = await api.get('/catalogo?preco_min=90&preco_max=200');
  assert.deepEqual(r.dados.produtos.map(p => p.nome), ['Camiseta Haze']);

  assert.equal((await api.get('/catalogo?ordem=aleatoria')).status, 400);
  assert.equal((await api.get('/catalogo?limite=500')).status, 400);
});

test('filtro de preço usa o preço promocional', async () => {

  const [campanha] = await db.query(
    "INSERT INTO campanhas (titulo, imagem_url, ativo, desconto_percentual) VALUES ('Promo', 'x', TRUE, 50)"
  );
  await db.query('INSERT INTO campanha_produtos VALUES (?, ?)', [campanha.insertId, moletomId]);

  const r = await api.get('/catalogo?preco_max=130&ordem=menor_preco');
  assert.deepEqual(r.dados.produtos.map(p => p.nome), ['Boné Esgotado', 'Camiseta Haze', 'Moletom Fog']);
  assert.equal(r.dados.produtos[2].preco, 125);
  assert.equal(r.dados.produtos[2].preco_original, 250);

  const promo = await api.get('/catalogo?promocao=1');
  assert.deepEqual(promo.dados.produtos.map(p => p.nome), ['Moletom Fog']);

  await db.query('DELETE FROM campanhas WHERE id = ?', [campanha.insertId]);
});

test('facetas para a barra de filtros', async () => {

  const r = await api.get('/catalogo/filtros');

  assert.equal(r.status, 200);
  assert.deepEqual(r.dados.categorias.map(c => [c.nome, c.total]), [['Camisetas', 2], ['Moletons', 1]]);
  assert.deepEqual(r.dados.tamanhos.map(t => t.valor), ['P', 'M', 'G']);
  assert.deepEqual(r.dados.cores.map(c => c.valor), ['Cinza', 'Preto']);
  assert.equal(r.dados.preco.minimo, 80);
  assert.equal(r.dados.preco.maximo, 250);
});

test('produtos relacionados: mesma categoria primeiro e só com estoque', async () => {
  const r = await api.get(`/produtos/${ids.produtoId}/relacionados`);
  assert.deepEqual(r.dados.map(p => p.nome), ['Moletom Fog']);
});

test('avaliações só depois de receber o produto; admin oculta', async () => {

  const conta = await cadastrarCliente(api, { email: 'avaliadora@teste.com' });
  const tokenCliente = conta.token;

  const tentar = () => api.post('/clientes/me/avaliacoes', {
    produto_id: ids.produtoId, nota: 5, titulo: 'Top', comentario: 'Muito boa'
  }, { token: tokenCliente });

  // Sem pedido
  assert.equal((await tentar()).status, 403);

  const corpo = pedidoValido([{ produto_id: ids.produtoId, variacao_id: ids.variacaoPId, quantidade: 1 }]);
  corpo.cliente.email = 'avaliadora@teste.com';
  const pedido = await api.post('/pedidos', corpo, { token: tokenCliente });
  const pedidoId = pedido.dados.pedido.id;

  // Pago mas não entregue
  await api.patch(`/admin/pedidos/${pedidoId}/status`, { status: 'pago' }, { token });
  assert.equal((await tentar()).status, 403);

  for (const status of ['em_preparacao', 'enviado', 'entregue']) {
    await api.patch(`/admin/pedidos/${pedidoId}/status`, { status }, { token });
  }

  const criada = await tentar();
  assert.equal(criada.status, 201);
  assert.equal(criada.dados.nota, 5);

  // Nota inválida e edição
  assert.equal((await api.post('/clientes/me/avaliacoes', { produto_id: ids.produtoId, nota: 6 }, { token: tokenCliente })).status, 400);
  await api.post('/clientes/me/avaliacoes', { produto_id: ids.produtoId, nota: 4 }, { token: tokenCliente });

  const minhas = await api.get('/clientes/me/avaliacoes', { token: tokenCliente });
  assert.equal(minhas.dados.length, 1);
  assert.equal(minhas.dados[0].nota, 4);

  let publico = await api.get(`/produtos/${ids.produtoId}/avaliacoes`);
  assert.equal(publico.dados.total, 1);
  assert.equal(publico.dados.media, 4);
  assert.equal(publico.dados.distribuicao[4], 1);
  assert.equal(publico.dados.avaliacoes[0].cliente_nome, 'Maria');

  const catalogo = await api.get('/catalogo?ordem=avaliacao');
  assert.equal(catalogo.dados.produtos[0].avaliacao_media, 4);

  // Moderação
  const lista = await api.get('/admin/avaliacoes', { token });
  await api.patch(`/admin/avaliacoes/${lista.dados[0].id}`, { visivel: false }, { token });

  publico = await api.get(`/produtos/${ids.produtoId}/avaliacoes`);
  assert.equal(publico.dados.total, 0);
});

test('health check traz versão e latência do banco', async () => {
  const r = await api.get('/health');
  assert.equal(r.dados.status, 'ok');
  assert.equal(r.dados.versao, '2.0.0');
  assert.equal(typeof r.dados.banco_ms, 'number');
  assert.equal(r.headers.get('cache-control'), 'no-store');
});
