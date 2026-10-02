const { Router } = require('express');

const valida = require('../../utils/validacao');
const { requisicaoInvalida } = require('../../utils/erros');
const { autenticarCliente } = require('../../middlewares/autenticacao');
const { criarLimitador } = require('../../middlewares/limiteTentativas');
const { lerEndereco } = require('./pedidos');
const clientesService = require('../../services/clientesService');
const enderecosService = require('../../services/enderecosService');
const pedidosService = require('../../services/pedidosService');
const carrinhoService = require('../../services/carrinhoService');

const router = Router();

// Cadastro e recuperação: 10 requisições por IP a cada 15 minutos
const limiteContas = criarLimitador({
  maximo: 10,
  janelaMs: 15 * 60 * 1000,
  mensagem: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
});

router.limiteContas = limiteContas;


/* =============================================================
   AUTENTICAÇÃO
============================================================= */

router.post('/clientes/cadastro', limiteContas.middleware, async (req, res) => {

  const { nome, email, telefone, senha } = req.body || {};

  const sessao = await clientesService.cadastrar({
    nome: valida.texto(nome, 'Informe seu nome', { max: 150, min: 2 }),
    email: valida.email(email),
    telefone: telefone ? valida.telefone(telefone) : null,
    senha: valida.senha(senha)
  });

  res.status(201).json({
    mensagem: 'Conta criada! Enviamos um e-mail para confirmar seu endereço.',
    ...sessao
  });
});

router.post('/clientes/login', async (req, res) => {

  const { email, senha } = req.body || {};

  if (typeof email !== 'string' || typeof senha !== 'string' || !email.trim() || !senha) {
    throw requisicaoInvalida('E-mail e senha são obrigatórios');
  }

  res.json(await clientesService.login({
    email: email.trim().toLowerCase(),
    senha,
    ip: req.ip
  }));
});

router.post('/clientes/refresh', async (req, res) => {
  res.json(await clientesService.renovarSessao(req.body?.refresh_token));
});

router.post('/clientes/logout', async (req, res) => {
  await clientesService.encerrarSessao(req.body?.refresh_token);
  res.json({ mensagem: 'Sessão encerrada' });
});

router.post('/clientes/recuperar-senha', limiteContas.middleware, async (req, res) => {

  await clientesService.solicitarRecuperacao(valida.email(req.body?.email));

  res.json({
    mensagem: 'Se houver uma conta com esse e-mail, você receberá um link para criar uma nova senha.'
  });
});

router.post('/clientes/redefinir-senha', limiteContas.middleware, async (req, res) => {

  await clientesService.redefinirSenha(
    req.body?.token,
    valida.senha(req.body?.senha)
  );

  res.json({ mensagem: 'Senha alterada! Faça login com a nova senha.' });
});

router.post('/clientes/verificar-email', async (req, res) => {
  await clientesService.verificarEmail(req.body?.token);
  res.json({ mensagem: 'E-mail confirmado com sucesso!' });
});


/* =============================================================
   PERFIL
============================================================= */

router.get('/clientes/me', autenticarCliente, async (req, res) => {
  res.json(await clientesService.perfil(req.cliente.id));
});

router.put('/clientes/me', autenticarCliente, async (req, res) => {

  const { nome, telefone } = req.body || {};

  res.json(await clientesService.atualizarPerfil(req.cliente.id, {
    nome: valida.texto(nome, 'Informe seu nome', { max: 150, min: 2 }),
    telefone: telefone ? valida.telefone(telefone) : null
  }));
});

router.patch('/clientes/me/senha', autenticarCliente, async (req, res) => {

  const { senha_atual: senhaAtual, senha_nova: senhaNova } = req.body || {};

  const sessao = await clientesService.trocarSenha(
    req.cliente.id,
    valida.texto(senhaAtual, 'Informe a senha atual', { max: 128 }),
    valida.senha(senhaNova)
  );

  res.json({
    mensagem: 'Senha alterada. As outras sessões foram encerradas.',
    ...sessao
  });
});

router.post('/clientes/me/reenviar-verificacao', autenticarCliente, async (req, res) => {
  await clientesService.reenviarVerificacao(req.cliente.id);
  res.json({ mensagem: 'Enviamos um novo e-mail de confirmação.' });
});

// LGPD: cópia dos dados pessoais
router.get('/clientes/me/dados', autenticarCliente, async (req, res) => {
  res.json(await clientesService.exportarDados(req.cliente.id));
});

// LGPD: exclusão da conta
router.delete('/clientes/me', autenticarCliente, async (req, res) => {
  await clientesService.excluirConta(
    req.cliente.id,
    valida.texto(req.body?.senha, 'Informe sua senha para confirmar', { max: 128 })
  );
  res.json({ mensagem: 'Conta excluída. Seus dados pessoais foram removidos.' });
});


/* =============================================================
   ENDEREÇOS
============================================================= */

function lerEnderecoCliente(corpo) {

  const dados = corpo || {};

  return {
    ...lerEndereco(dados),
    apelido: valida.texto(dados.apelido, 'Apelido inválido', { max: 50, opcional: true }),
    destinatario: valida.texto(dados.destinatario, 'Destinatário inválido', { max: 150, opcional: true }),
    principal: valida.paraBoolean(dados.principal)
  };
}

router.get('/clientes/me/enderecos', autenticarCliente, async (req, res) => {
  res.json(await enderecosService.listar(req.cliente.id));
});

router.post('/clientes/me/enderecos', autenticarCliente, async (req, res) => {
  res.status(201).json(
    await enderecosService.criar(req.cliente.id, lerEnderecoCliente(req.body))
  );
});

router.put('/clientes/me/enderecos/:id', autenticarCliente, async (req, res) => {
  res.json(await enderecosService.atualizar(
    req.cliente.id,
    valida.id(req.params.id),
    lerEnderecoCliente(req.body)
  ));
});

router.patch('/clientes/me/enderecos/:id/principal', autenticarCliente, async (req, res) => {
  res.json(await enderecosService.definirPrincipal(req.cliente.id, valida.id(req.params.id)));
});

router.delete('/clientes/me/enderecos/:id', autenticarCliente, async (req, res) => {
  await enderecosService.remover(req.cliente.id, valida.id(req.params.id));
  res.json({ mensagem: 'Endereço removido' });
});


/* =============================================================
   MEUS PEDIDOS
============================================================= */

router.get('/clientes/me/pedidos', autenticarCliente, async (req, res) => {
  res.json(await pedidosService.listarDoCliente(req.cliente.id));
});

router.get('/clientes/me/pedidos/:id', autenticarCliente, async (req, res) => {

  const pedido = await pedidosService.buscarCompleto(
    valida.id(req.params.id, 'ID do pedido inválido'),
    { clienteId: req.cliente.id }
  );

  // O cliente não precisa ver quem do time alterou o status
  pedido.historico = pedido.historico.map(({ admin_nome: _, ...item }) => item);

  res.json(pedido);
});


/* =============================================================
   CARRINHO
============================================================= */

// Público: confere preços e estoque da sacola (visitante ou logado)
router.post('/carrinho/validar', async (req, res) => {
  res.json(await carrinhoService.validar(req.body?.itens));
});

router.get('/clientes/me/carrinho', autenticarCliente, async (req, res) => {
  res.json(await carrinhoService.obter(req.cliente.id));
});

router.put('/clientes/me/carrinho', autenticarCliente, async (req, res) => {
  res.json(await carrinhoService.salvar(
    req.cliente.id,
    req.body?.itens,
    { mesclar: valida.paraBoolean(req.body?.mesclar) }
  ));
});


module.exports = router;
