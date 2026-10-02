const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  prepararAmbiente,
  finalizarAmbiente,
  imagensRemovidas,
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


function formImagem() {
  const form = new FormData();
  form.append('imagem', new Blob([Buffer.from('fake')], { type: 'image/png' }), 'foto.png');
  return form;
}


test('produto novo sempre nasce inativo e só ativa com foto, variação e estoque', async () => {

  const criado = await api.post('/produtos', {
    nome: '  Moletom  ',
    descricao: 'Quente',
    preco: '199.9',
    categoria_id: ids.categoriaId,
    ativo: 1,
    destaque_home: 0
  }, { token });

  assert.equal(criado.status, 201);
  assert.equal(criado.dados.nome, 'Moletom');
  assert.equal(Number(criado.dados.ativo), 0);
  assert.equal(Number(criado.dados.preco), 199.9);
  assert.match(criado.dados.aviso, /inativo/);

  const produtoId = criado.dados.id;

  const edicao = {
    nome: 'Moletom',
    descricao: 'Quente',
    preco: 199.9,
    categoria_id: ids.categoriaId,
    ativo: true,
    destaque_home: false
  };

  // Sem foto
  let resposta = await api.put(`/produtos/${produtoId}`, edicao, { token });
  assert.equal(resposta.status, 200);
  assert.match(resposta.dados.aviso, /foto principal/);
  assert.equal(Number(resposta.dados.ativo), 0);

  // Primeira foto vira principal automaticamente
  const foto = await api.enviar('POST', `/produtos/${produtoId}/imagens`, formImagem(), { token });
  assert.equal(foto.status, 201);
  assert.equal(Number(foto.dados.imagem.principal), 1);

  // Sem variação
  resposta = await api.put(`/produtos/${produtoId}`, edicao, { token });
  assert.match(resposta.dados.aviso, /variação/);

  // Variação sem estoque
  const variacao = await api.post(`/produtos/${produtoId}/variacoes`, {
    tamanho: 'G', cor: 'Cinza', sku: 'MOL-CIN-G', estoque: 0
  }, { token });
  assert.equal(variacao.status, 201);

  assert.equal(
    (await api.patch(`/produtos/${produtoId}/reativar`, undefined, { token })).status,
    400
  );

  // Entrada de estoque
  const entrada = await api.patch(
    `/produtos/${produtoId}/variacoes/${variacao.dados.id}/estoque`,
    { entrada: 3, motivo: 'Chegada fornecedor' },
    { token }
  );
  assert.equal(entrada.status, 200);
  assert.equal(entrada.dados.variacao.estoque, 3);

  resposta = await api.put(`/produtos/${produtoId}`, edicao, { token });
  assert.equal(resposta.dados.aviso, null);
  assert.equal(Number(resposta.dados.ativo), 1);
});

test('validações do cadastro de produto', async () => {

  const base = { nome: 'X', preco: 10, categoria_id: ids.categoriaId };

  assert.equal((await api.post('/produtos', { ...base, nome: 123 }, { token })).status, 400);
  assert.equal((await api.post('/produtos', { ...base, preco: 0 }, { token })).status, 400);
  assert.equal((await api.post('/produtos', { ...base, preco: 'abc' }, { token })).status, 400);
  assert.equal((await api.post('/produtos', { ...base, categoria_id: 999 }, { token })).status, 400);
  assert.equal((await api.post('/produtos', { nome: 'X' }, { token })).status, 400);
});

test('desativar, reativar e destacar produto', async () => {

  assert.equal((await api.delete(`/produtos/${ids.produtoId}`, { token })).status, 200);
  assert.equal((await api.get(`/produtos/${ids.produtoId}`)).status, 404);

  const reativado = await api.patch(`/produtos/${ids.produtoId}/reativar`, undefined, { token });
  assert.equal(reativado.status, 200);

  assert.equal(
    (await api.patch(`/admin/produtos/${ids.produtoId}/destaque`, { destaque_home: 'sim' }, { token })).status,
    400
  );

  const destaque = await api.patch(
    `/admin/produtos/${ids.produtoId}/destaque`,
    { destaque_home: false },
    { token }
  );
  assert.equal(destaque.status, 200);
  assert.equal(Number(destaque.dados.produto.destaque_home), 0);

  assert.equal((await api.delete('/produtos/99999', { token })).status, 404);
});

test('variações: SKU e tamanho/cor duplicados retornam 409', async () => {

  const duplicadaSku = await api.post(`/produtos/${ids.produtoId}/variacoes`, {
    tamanho: 'GG', cor: 'Preto', sku: 'CAM-PRE-P', estoque: 1
  }, { token });
  assert.equal(duplicadaSku.status, 409);
  assert.equal(duplicadaSku.dados.mensagem, 'Este SKU já está sendo utilizado');

  const duplicadaCor = await api.post(`/produtos/${ids.produtoId}/variacoes`, {
    tamanho: 'P', cor: 'Preto', sku: 'NOVO-SKU', estoque: 1
  }, { token });
  assert.equal(duplicadaCor.status, 409);

  const edicao = await api.put(
    `/produtos/${ids.produtoId}/variacoes/${ids.variacaoMId}`,
    { tamanho: 'M', cor: 'Preto', sku: 'CAM-PRE-P', estoque: 2, ativo: 1 },
    { token }
  );
  assert.equal(edicao.status, 409);
});

test('ajuste de estoque registra movimentação', async () => {

  const ajuste = await api.patch(
    `/produtos/${ids.produtoId}/variacoes/${ids.variacaoPId}/estoque`,
    { estoque: 9, estoque_minimo: 3 },
    { token }
  );

  assert.equal(ajuste.status, 200);
  assert.equal(await estoqueDe(ids.variacaoPId), 9);
  assert.equal(ajuste.dados.variacao.estoque_minimo, 3);

  assert.equal(
    (await api.patch(`/produtos/${ids.produtoId}/variacoes/${ids.variacaoPId}/estoque`, { estoque: -1 }, { token })).status,
    400
  );

  const movimentacoes = await api.get(
    `/admin/estoque/movimentacoes?variacao_id=${ids.variacaoPId}`,
    { token }
  );

  assert.equal(movimentacoes.status, 200);
  assert.equal(movimentacoes.dados[0].tipo, 'ajuste');
  assert.equal(movimentacoes.dados[0].estoque_anterior, 5);
  assert.equal(movimentacoes.dados[0].estoque_novo, 9);
});

test('estoque baixo e inventário', async () => {

  await db.query('UPDATE produto_variacoes SET estoque_minimo = 5 WHERE id = ?', [ids.variacaoMId]);

  const baixo = await api.get('/admin/estoque/baixo', { token });
  assert.ok(baixo.dados.some(v => v.id === ids.variacaoMId));

  const inventario = await api.get('/admin/estoque/inventario', { token });
  assert.ok(inventario.dados.length >= 2);
});

test('remover foto principal promove outra e apaga do Cloudinary', async () => {

  await api.enviar('POST', `/produtos/${ids.produtoId}/imagens`, formImagem(), { token });

  const imagens = await api.get(`/produtos/${ids.produtoId}/imagens`);
  const principal = imagens.dados.find(imagem => Number(imagem.principal) === 1);

  await db.query(
    "UPDATE produto_imagens SET cloudinary_public_id = 'haze/antiga' WHERE id = ?",
    [principal.id]
  );

  const remocao = await api.delete(
    `/produtos/${ids.produtoId}/imagens/${principal.id}`,
    { token }
  );

  assert.equal(remocao.status, 200);
  assert.ok(imagensRemovidas.includes('haze/antiga'));

  const restantes = await api.get(`/produtos/${ids.produtoId}/imagens`);
  assert.equal(restantes.dados.length, 1);
  assert.equal(Number(restantes.dados[0].principal), 1);
});

test('upload rejeita formato não permitido', async () => {

  const form = new FormData();
  form.append('imagem', new Blob(['x'], { type: 'text/plain' }), 'a.txt');

  const resposta = await api.enviar('POST', `/produtos/${ids.produtoId}/imagens`, form, { token });
  assert.equal(resposta.status, 400);
});

test('categorias: criar, renomear (bug corrigido), duplicar e desativar', async () => {

  const criada = await api.post('/categorias', { nome: 'Calças' }, { token });
  assert.equal(criada.status, 201);

  const renomeada = await api.put(`/categorias/${criada.dados.id}`, { nome: 'Calças Jeans' }, { token });
  assert.equal(renomeada.status, 200);
  assert.equal(renomeada.dados.nome, 'Calças Jeans');

  const duplicada = await api.put(`/categorias/${criada.dados.id}`, { nome: 'Camisetas' }, { token });
  assert.equal(duplicada.status, 409);

  assert.equal((await api.put('/categorias/9999', { nome: 'Nada' }, { token })).status, 404);
  assert.equal((await api.delete(`/categorias/${criada.dados.id}`, { token })).status, 200);

  const publicas = await api.get('/categorias');
  assert.ok(!publicas.dados.some(c => c.id === criada.dados.id));

  assert.equal((await api.patch(`/categorias/${criada.dados.id}/reativar`, undefined, { token })).status, 200);
});

test('campanhas: criar, só uma ativa, atualizar imagem e link seguro', async () => {

  const form = () => {
    const f = formImagem();
    f.append('titulo', 'Drop 01');
    f.append('ativo', 'true');
    f.append('link_botao', 'catalogo.html');
    return f;
  };

  const primeira = await api.enviar('POST', '/admin/campanhas', form(), { token });
  assert.equal(primeira.status, 201);

  const segunda = await api.enviar('POST', '/admin/campanhas', form(), { token });
  assert.equal(segunda.status, 201);

  const lista = await api.get('/admin/campanhas', { token });
  assert.equal(lista.dados.filter(c => Number(c.ativo) === 1).length, 1);

  const publica = await api.get('/campanha');
  assert.equal(publica.status, 200);
  assert.equal(publica.dados.id, segunda.dados.campanha.id);

  const ativada = await api.patch(`/admin/campanhas/${primeira.dados.campanha.id}/ativar`, undefined, { token });
  assert.equal(ativada.status, 200);
  assert.equal((await api.get('/campanha')).dados.id, primeira.dados.campanha.id);

  const perigosa = new FormData();
  perigosa.append('titulo', 'X');
  perigosa.append('link_botao', 'javascript:alert(1)');

  assert.equal(
    (await api.enviar('PUT', `/admin/campanhas/${primeira.dados.campanha.id}`, perigosa, { token })).status,
    400
  );

  const imagemAntiga = primeira.dados.campanha.cloudinary_public_id;
  const comImagem = form();

  const atualizada = await api.enviar('PUT', `/admin/campanhas/${primeira.dados.campanha.id}`, comImagem, { token });
  assert.equal(atualizada.status, 200);
  assert.ok(imagensRemovidas.includes(imagemAntiga));

  assert.equal((await api.delete(`/admin/campanhas/${primeira.dados.campanha.id}`, { token })).status, 200);
  assert.equal((await api.get('/campanha')).status, 404);
});
