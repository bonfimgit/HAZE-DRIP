const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  prepararAmbiente,
  finalizarAmbiente,
  pedidoValido,
  cadastrarCliente,
  tokenDoUltimoEmail,
  enviadosEmTeste,
  aguardar,
  db
} = require('./ajuda');

let api;
let ids;
let tokenAdmin;

before(async () => {
  ({ api, ids, tokenAdmin } = await prepararAmbiente());
});

after(async () => {
  await finalizarAmbiente(api);
});

// Os limites de cadastro/recuperação são por IP; nos testes todos vêm do mesmo IP
beforeEach(() => {
  require('../src/routes/loja/clientes').limiteContas.limparTudo();
  require('../src/services/clientesService').limitadorRecuperacao.limparTudo();
});


function item(variacaoId, quantidade) {
  return { produto_id: ids.produtoId, variacao_id: variacaoId, quantidade };
}


test('cadastro valida dados, cria sessão e envia confirmação de e-mail', async () => {

  assert.equal((await api.post('/clientes/cadastro', {
    nome: 'A', email: 'x@teste.com', senha: 'Senha1234'
  })).status, 400);

  assert.equal((await api.post('/clientes/cadastro', {
    nome: 'Ana', email: 'x@teste.com', senha: 'fraca'
  })).status, 400);

  const conta = await cadastrarCliente(api);

  assert.ok(conta.token);
  assert.ok(conta.refresh_token);
  assert.equal(conta.cliente.email, 'maria@teste.com');
  assert.equal(conta.cliente.email_verificado, false);

  const duplicado = await api.post('/clientes/cadastro', {
    nome: 'Maria', email: 'MARIA@teste.com', senha: 'Senha1234'
  });
  assert.equal(duplicado.status, 409);

  const perfil = await api.get('/clientes/me', { token: conta.token });
  assert.equal(perfil.status, 200);
  assert.equal(perfil.dados.nome, 'Maria Cliente');

  // Confirmação de e-mail
  const tokenEmail = tokenDoUltimoEmail('maria@teste.com', 'Confirme seu e-mail');
  assert.equal((await api.post('/clientes/verificar-email', { token: tokenEmail })).status, 200);
  assert.equal((await api.post('/clientes/verificar-email', { token: tokenEmail })).status, 400);

  const verificado = await api.get('/clientes/me', { token: conta.token });
  assert.equal(verificado.dados.email_verificado, true);
});

test('login, refresh rotativo e logout', async () => {

  assert.equal((await api.post('/clientes/login', {
    email: 'maria@teste.com', senha: 'errada'
  })).status, 401);

  const login = await api.post('/clientes/login', {
    email: 'Maria@Teste.com', senha: 'Senha1234'
  });
  assert.equal(login.status, 200);

  const renovado = await api.post('/clientes/refresh', { refresh_token: login.dados.refresh_token });
  assert.equal(renovado.status, 200);
  assert.notEqual(renovado.dados.refresh_token, login.dados.refresh_token);

  // Reuso de refresh token antigo derruba todas as sessões
  const reuso = await api.post('/clientes/refresh', { refresh_token: login.dados.refresh_token });
  assert.equal(reuso.status, 401);

  const depoisDoReuso = await api.post('/clientes/refresh', { refresh_token: renovado.dados.refresh_token });
  assert.equal(depoisDoReuso.status, 401);

  const novoLogin = await api.post('/clientes/login', { email: 'maria@teste.com', senha: 'Senha1234' });
  assert.equal((await api.post('/clientes/logout', { refresh_token: novoLogin.dados.refresh_token })).status, 200);
  assert.equal((await api.post('/clientes/refresh', { refresh_token: novoLogin.dados.refresh_token })).status, 401);
});

test('token de admin não acessa rotas do cliente', async () => {
  assert.equal((await api.get('/clientes/me', { token: tokenAdmin })).status, 401);
});

test('recuperação de senha não revela contas e invalida sessões', async () => {

  const desconhecido = await api.post('/clientes/recuperar-senha', { email: 'ninguem@teste.com' });
  assert.equal(desconhecido.status, 200);

  const sessao = await api.post('/clientes/login', { email: 'maria@teste.com', senha: 'Senha1234' });

  const pedido = await api.post('/clientes/recuperar-senha', { email: 'maria@teste.com' });
  assert.equal(pedido.status, 200);
  assert.equal(pedido.dados.mensagem, desconhecido.dados.mensagem);

  const token = tokenDoUltimoEmail('maria@teste.com', 'Redefinição de senha');

  assert.equal((await api.post('/clientes/redefinir-senha', { token, senha: 'curta' })).status, 400);
  assert.equal((await api.post('/clientes/redefinir-senha', { token, senha: 'NovaSenha99' })).status, 200);
  assert.equal((await api.post('/clientes/redefinir-senha', { token, senha: 'OutraSenha99' })).status, 400);

  assert.equal((await api.get('/clientes/me', { token: sessao.dados.token })).status, 401);
  assert.equal((await api.post('/clientes/login', { email: 'maria@teste.com', senha: 'NovaSenha99' })).status, 200);
});

test('perfil e troca de senha', async () => {

  const login = await api.post('/clientes/login', { email: 'maria@teste.com', senha: 'NovaSenha99' });
  const token = login.dados.token;

  const atualizado = await api.put('/clientes/me', { nome: 'Maria Silva', telefone: '35999998888' }, { token });
  assert.equal(atualizado.status, 200);
  assert.equal(atualizado.dados.nome, 'Maria Silva');

  assert.equal((await api.patch('/clientes/me/senha', { senha_atual: 'x', senha_nova: 'Senha1234' }, { token })).status, 400);

  const troca = await api.patch('/clientes/me/senha', { senha_atual: 'NovaSenha99', senha_nova: 'Senha1234' }, { token });
  assert.equal(troca.status, 200);
  assert.equal((await api.get('/clientes/me', { token })).status, 401);
  assert.equal((await api.get('/clientes/me', { token: troca.dados.token })).status, 200);
});

test('endereços: primeiro é principal, troca de principal, limite e posse', async () => {

  const { token } = (await api.post('/clientes/login', { email: 'maria@teste.com', senha: 'Senha1234' })).dados;

  const endereco = {
    apelido: 'Casa', cep: '37900000', rua: 'Rua A', numero: '1',
    bairro: 'Centro', cidade: 'Passos', estado: 'mg'
  };

  const primeiro = await api.post('/clientes/me/enderecos', endereco, { token });
  assert.equal(primeiro.status, 201);
  assert.equal(Number(primeiro.dados.principal), 1);
  assert.equal(primeiro.dados.cep, '37900-000');
  assert.equal(primeiro.dados.estado, 'MG');

  const segundo = await api.post('/clientes/me/enderecos', { ...endereco, apelido: 'Trabalho', principal: true }, { token });
  assert.equal(Number(segundo.dados.principal), 1);

  let lista = await api.get('/clientes/me/enderecos', { token });
  assert.equal(lista.dados.filter(e => Number(e.principal)).length, 1);
  assert.equal(lista.dados[0].id, segundo.dados.id);

  const editado = await api.put(`/clientes/me/enderecos/${primeiro.dados.id}`, { ...endereco, numero: '99' }, { token });
  assert.equal(editado.dados.numero, '99');

  // Remover o principal promove outro
  await api.delete(`/clientes/me/enderecos/${segundo.dados.id}`, { token });
  lista = await api.get('/clientes/me/enderecos', { token });
  assert.equal(lista.dados.length, 1);
  assert.equal(Number(lista.dados[0].principal), 1);

  // Outro cliente não acessa
  const outro = await cadastrarCliente(api, { email: 'joao@teste.com' });
  assert.equal(
    (await api.put(`/clientes/me/enderecos/${primeiro.dados.id}`, endereco, { token: outro.token })).status,
    404
  );
});

test('pedido logado vincula ao cliente, usa endereço salvo e aparece em Meus pedidos', async () => {

  const { token } = (await api.post('/clientes/login', { email: 'maria@teste.com', senha: 'Senha1234' })).dados;
  const enderecos = await api.get('/clientes/me/enderecos', { token });

  await api.put('/clientes/me/carrinho', { itens: [{ variacao_id: ids.variacaoPId, quantidade: 1 }] }, { token });

  const corpo = pedidoValido([item(ids.variacaoPId, 1)]);
  delete corpo.endereco;
  corpo.endereco_id = enderecos.dados[0].id;

  const criado = await api.post('/pedidos', corpo, { token });
  assert.equal(criado.status, 201);

  const carrinho = await api.get('/clientes/me/carrinho', { token });
  assert.equal(carrinho.dados.itens.length, 0);

  const meus = await api.get('/clientes/me/pedidos', { token });
  assert.equal(meus.dados.length, 1);
  assert.equal(meus.dados[0].quantidade_itens, 1);

  const detalhe = await api.get(`/clientes/me/pedidos/${criado.dados.pedido.id}`, { token });
  assert.equal(detalhe.status, 200);
  assert.equal(detalhe.dados.endereco_numero, '99');
  assert.ok(detalhe.dados.historico.length >= 1);
  assert.equal(detalhe.dados.historico[0].admin_nome, undefined);

  // Outro cliente não vê o pedido
  const outro = (await api.post('/clientes/login', { email: 'joao@teste.com', senha: 'Senha1234' })).dados;
  assert.equal((await api.get(`/clientes/me/pedidos/${criado.dados.pedido.id}`, { token: outro.token })).status, 404);

  // Endereço de outro cliente não pode ser usado
  const invasor = await api.post('/pedidos', corpo, { token: outro.token });
  assert.equal(invasor.status, 404);

  // E-mail de pedido criado
  await aguardar();
  assert.ok(enviadosEmTeste.some(e => e.assunto.includes(`Pedido #${criado.dados.pedido.id}`)));
});

test('pedidos antigos sem login só são vinculados após confirmar o e-mail', async () => {

  const anonimo = await api.post('/pedidos', {
    ...pedidoValido([item(ids.variacaoPId, 1)]),
    cliente: { nome: 'Pedro', email: 'pedro@teste.com', telefone: '35999999999' }
  });
  assert.equal(anonimo.status, 201);

  const conta = await cadastrarCliente(api, { email: 'pedro@teste.com', nome: 'Pedro' });

  let meus = await api.get('/clientes/me/pedidos', { token: conta.token });
  assert.equal(meus.dados.length, 0);

  const tokenEmail = tokenDoUltimoEmail('pedro@teste.com', 'Confirme seu e-mail');
  await api.post('/clientes/verificar-email', { token: tokenEmail });

  meus = await api.get('/clientes/me/pedidos', { token: conta.token });
  assert.equal(meus.dados.length, 1);
});

test('carrinho: validação pública, ajuste ao estoque, mesclagem e itens indisponíveis', async () => {

  const validacao = await api.post('/carrinho/validar', {
    itens: [
      { variacao_id: ids.variacaoMId, quantidade: 50 },
      { variacao_id: 99999, quantidade: 1 }
    ]
  });

  assert.equal(validacao.status, 200);
  assert.equal(validacao.dados.valido, false);

  const ajustado = validacao.dados.itens.find(i => i.variacao_id === ids.variacaoMId);
  assert.equal(ajustado.quantidade, 2);
  assert.equal(ajustado.ajustado, true);
  assert.equal(ajustado.preco, 100);
  assert.equal(validacao.dados.itens.find(i => i.variacao_id === 99999).disponivel, false);

  const { token } = (await api.post('/clientes/login', { email: 'joao@teste.com', senha: 'Senha1234' })).dados;

  await api.put('/clientes/me/carrinho', { itens: [{ variacao_id: ids.variacaoPId, quantidade: 1 }] }, { token });

  const mesclado = await api.put('/clientes/me/carrinho', {
    itens: [{ variacao_id: ids.variacaoPId, quantidade: 1 }, { variacao_id: ids.variacaoMId, quantidade: 1 }],
    mesclar: true
  }, { token });

  assert.equal(mesclado.dados.itens.find(i => i.variacao_id === ids.variacaoPId).quantidade, 2);
  assert.equal(mesclado.dados.itens.length, 2);

  await db.query('UPDATE produtos SET ativo = FALSE WHERE id = ?', [ids.produtoId]);
  const indisponivel = await api.get('/clientes/me/carrinho', { token });
  assert.ok(indisponivel.dados.itens.every(i => !i.disponivel));
  await db.query('UPDATE produtos SET ativo = TRUE WHERE id = ?', [ids.produtoId]);
});

test('admin: lista, detalha e bloqueia cliente', async () => {

  const lista = await api.get('/admin/clientes?busca=maria@teste', { token: tokenAdmin });
  assert.equal(lista.status, 200);
  assert.equal(lista.dados.total, 1);

  const maria = lista.dados.clientes[0];
  assert.equal(maria.total_pedidos, 1);

  const detalhe = await api.get(`/admin/clientes/${maria.id}`, { token: tokenAdmin });
  assert.equal(detalhe.dados.enderecos.length, 1);
  assert.equal(detalhe.dados.estatisticas.total_pedidos, 1);

  const sessao = (await api.post('/clientes/login', { email: 'maria@teste.com', senha: 'Senha1234' })).dados;

  const bloqueio = await api.patch(`/admin/clientes/${maria.id}/bloqueio`, { bloqueado: true, motivo: 'Fraude' }, { token: tokenAdmin });
  assert.equal(bloqueio.status, 200);
  assert.equal(bloqueio.dados.bloqueado, true);

  assert.equal((await api.get('/clientes/me', { token: sessao.token })).status, 401);
  assert.equal((await api.post('/clientes/refresh', { refresh_token: sessao.refresh_token })).status, 401);
  assert.equal((await api.post('/clientes/login', { email: 'maria@teste.com', senha: 'Senha1234' })).status, 403);

  await api.patch(`/admin/clientes/${maria.id}/bloqueio`, { bloqueado: false }, { token: tokenAdmin });
  assert.equal((await api.post('/clientes/login', { email: 'maria@teste.com', senha: 'Senha1234' })).status, 200);
});

test('LGPD: exportar dados e excluir conta', async () => {

  const { token } = (await api.post('/clientes/login', { email: 'maria@teste.com', senha: 'Senha1234' })).dados;

  const exportacao = await api.get('/clientes/me/dados', { token });
  assert.equal(exportacao.status, 200);
  assert.equal(exportacao.dados.conta.email, 'maria@teste.com');
  assert.equal(exportacao.dados.pedidos.length, 1);

  assert.equal((await api.delete('/clientes/me', { token, corpo: { senha: 'errada' } })).status, 400);

  const exclusao = await api.delete('/clientes/me', { token, corpo: { senha: 'Senha1234' } });
  assert.equal(exclusao.status, 200);

  assert.equal((await api.get('/clientes/me', { token })).status, 401);
  assert.equal((await api.post('/clientes/login', { email: 'maria@teste.com', senha: 'Senha1234' })).status, 401);

  // O e-mail fica livre para um novo cadastro e os pedidos continuam no admin
  const [enderecos] = await db.query("SELECT COUNT(*) AS total FROM cliente_enderecos");
  assert.equal(Number(enderecos[0].total), 0);

  const [pedidos] = await db.query('SELECT COUNT(*) AS total FROM pedidos');
  assert.ok(Number(pedidos[0].total) >= 2);
});
