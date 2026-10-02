const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = require('../config/db');
const config = require('../config/ambiente');
const {
  naoAutorizado,
  conflito,
  naoEncontrado,
  requisicaoInvalida,
  muitasRequisicoes,
  proibido
} = require('../utils/erros');
const { criarLimitador } = require('../middlewares/limiteTentativas');
const emailService = require('./emailService');
const templates = require('../emails/templates');
const logger = require('../utils/logger');


const DURACAO_ACESSO = '30m';
const DIAS_SESSAO = 30;

const DURACAO_TOKEN = {
  recuperar_senha: 60 * 60 * 1000,           // 1 hora
  verificar_email: 48 * 60 * 60 * 1000       // 48 horas
};

// 5 tentativas de senha errada por IP + e-mail a cada 15 minutos
const limitadorLogin = criarLimitador({
  maximo: 5,
  janelaMs: 15 * 60 * 1000
});

// 3 pedidos de recuperação por e-mail a cada hora
const limitadorRecuperacao = criarLimitador({
  maximo: 3,
  janelaMs: 60 * 60 * 1000
});


/*
  Pedidos feitos sem login com o mesmo e-mail passam a aparecer em
  "Meus pedidos". Só depois que o cliente comprova ser dono do e-mail;
  antes disso, qualquer pessoa poderia se cadastrar com o e-mail de
  outra e ver os pedidos dela.
*/
async function vincularPedidosAntigos(clienteId) {

  await db.execute(
    `UPDATE pedidos p
     INNER JOIN clientes c ON c.id = ?
     SET p.cliente_id = c.id
     WHERE p.cliente_email = c.email
     AND p.cliente_id IS NULL`,
    [clienteId]
  );
}


function hash(valor) {
  return crypto.createHash('sha256').update(valor).digest('hex');
}

function tokenAleatorio() {
  return crypto.randomBytes(32).toString('hex');
}


function dadosPublicos(cliente) {
  return {
    id: cliente.id,
    nome: cliente.nome,
    email: cliente.email,
    telefone: cliente.telefone,
    email_verificado: Boolean(cliente.email_verificado_em),
    criado_em: cliente.criado_em
  };
}


async function buscarPorId(id) {

  const [clientes] = await db.execute(
    'SELECT * FROM clientes WHERE id = ?',
    [id]
  );

  return clientes[0] || null;
}


/* =============================================================
   SESSÃO: token de acesso (curto) + refresh token (longo, rotativo)
============================================================= */

function gerarTokenAcesso(cliente) {
  return jwt.sign(
    {
      tipo: 'cliente',
      id: cliente.id,
      tv: cliente.token_versao || 0
    },
    config.jwtSecret,
    { expiresIn: DURACAO_ACESSO }
  );
}


async function criarSessao(cliente) {

  const refreshToken = tokenAleatorio();

  await db.execute(
    `INSERT INTO cliente_sessoes (cliente_id, token_hash, expira_em)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))`,
    [cliente.id, hash(refreshToken), DIAS_SESSAO]
  );

  return {
    token: gerarTokenAcesso(cliente),
    refresh_token: refreshToken,
    cliente: dadosPublicos(cliente)
  };
}


async function revogarTodasSessoes(clienteId) {
  await db.execute(
    `UPDATE cliente_sessoes
     SET revogado_em = NOW()
     WHERE cliente_id = ?
     AND revogado_em IS NULL`,
    [clienteId]
  );
}


/*
  Confere se o cliente do token de acesso continua válido.
  Usado pelo middleware autenticarCliente.
*/
async function validarSessao(dadosToken) {

  const cliente = await buscarPorId(dadosToken.id);

  if (
    !cliente ||
    cliente.excluido_em ||
    Number(cliente.bloqueado) ||
    Number(cliente.token_versao) !== Number(dadosToken.tv || 0)
  ) {
    throw naoAutorizado('Sessão expirada. Faça login novamente.');
  }

  return cliente;
}


async function renovarSessao(refreshToken) {

  if (typeof refreshToken !== 'string' || !refreshToken) {
    throw naoAutorizado('Sessão expirada. Faça login novamente.');
  }

  const [sessoes] = await db.execute(
    `SELECT *
     FROM cliente_sessoes
     WHERE token_hash = ?`,
    [hash(refreshToken)]
  );

  const sessao = sessoes[0];

  if (!sessao) {
    throw naoAutorizado('Sessão expirada. Faça login novamente.');
  }

  /*
    Refresh token já usado: indica possível roubo.
    Encerra todas as sessões do cliente por segurança.
  */
  if (sessao.revogado_em) {
    await revogarTodasSessoes(sessao.cliente_id);
    throw naoAutorizado('Sessão expirada. Faça login novamente.');
  }

  if (new Date(sessao.expira_em) < new Date()) {
    throw naoAutorizado('Sessão expirada. Faça login novamente.');
  }

  const cliente = await buscarPorId(sessao.cliente_id);

  if (!cliente || cliente.excluido_em || Number(cliente.bloqueado)) {
    throw naoAutorizado('Sessão expirada. Faça login novamente.');
  }

  // Rotação: o refresh token atual deixa de valer
  await db.execute(
    'UPDATE cliente_sessoes SET revogado_em = NOW() WHERE id = ?',
    [sessao.id]
  );

  return criarSessao(cliente);
}


async function encerrarSessao(refreshToken) {

  if (typeof refreshToken !== 'string' || !refreshToken) {
    return;
  }

  await db.execute(
    `UPDATE cliente_sessoes
     SET revogado_em = NOW()
     WHERE token_hash = ?
     AND revogado_em IS NULL`,
    [hash(refreshToken)]
  );
}


/* =============================================================
   TOKENS DE USO ÚNICO (e-mail)
============================================================= */

async function criarTokenUnico(clienteId, tipo) {

  const token = tokenAleatorio();

  // Invalida tokens anteriores do mesmo tipo
  await db.execute(
    `UPDATE cliente_tokens
     SET usado_em = NOW()
     WHERE cliente_id = ?
     AND tipo = ?
     AND usado_em IS NULL`,
    [clienteId, tipo]
  );

  await db.execute(
    `INSERT INTO cliente_tokens (cliente_id, tipo, token_hash, expira_em)
     VALUES (?, ?, ?, ?)`,
    [clienteId, tipo, hash(token), new Date(Date.now() + DURACAO_TOKEN[tipo])]
  );

  return token;
}


async function consumirTokenUnico(token, tipo) {

  if (typeof token !== 'string' || !token) {
    throw requisicaoInvalida('Link inválido ou expirado');
  }

  const [tokens] = await db.execute(
    `SELECT *
     FROM cliente_tokens
     WHERE token_hash = ?
     AND tipo = ?`,
    [hash(token), tipo]
  );

  const registro = tokens[0];

  if (!registro || registro.usado_em || new Date(registro.expira_em) < new Date()) {
    throw requisicaoInvalida('Link inválido ou expirado');
  }

  const [resultado] = await db.execute(
    'UPDATE cliente_tokens SET usado_em = NOW() WHERE id = ? AND usado_em IS NULL',
    [registro.id]
  );

  // Duas requisições simultâneas com o mesmo token: só uma vale
  if (resultado.affectedRows === 0) {
    throw requisicaoInvalida('Link inválido ou expirado');
  }

  return registro.cliente_id;
}


async function enviarVerificacao(cliente) {

  const token = await criarTokenUnico(cliente.id, 'verificar_email');
  const email = templates.verificacaoEmail({ nome: cliente.nome, token });

  try {
    await emailService.enviar({ para: cliente.email, ...email });
  } catch (erro) {
    logger.erro('Falha ao enviar e-mail de verificação', { erro: erro.message });
  }
}


/* =============================================================
   CADASTRO E LOGIN
============================================================= */

async function cadastrar({ nome, email, telefone, senha }) {

  const senhaHash = await bcrypt.hash(senha, 12);

  let resultado;

  try {
    [resultado] = await db.execute(
      `INSERT INTO clientes (nome, email, telefone, senha_hash)
       VALUES (?, ?, ?, ?)`,
      [nome, email, telefone, senhaHash]
    );
  } catch (erro) {
    if (erro.code === 'ER_DUP_ENTRY') {
      throw conflito('Já existe uma conta com esse e-mail');
    }
    throw erro;
  }

  const cliente = await buscarPorId(resultado.insertId);

  await enviarVerificacao(cliente);

  return criarSessao(cliente);
}


async function login({ email, senha, ip }) {

  const chave = `${ip}|${email}`;

  if (limitadorLogin.bloqueado(chave)) {
    throw muitasRequisicoes('Muitas tentativas inválidas. Tente novamente em 15 minutos.');
  }

  const [clientes] = await db.execute(
    'SELECT * FROM clientes WHERE email = ? AND excluido_em IS NULL',
    [email]
  );

  const cliente = clientes[0];

  const senhaCorreta = cliente
    ? await bcrypt.compare(senha, cliente.senha_hash)
    : false;

  if (!senhaCorreta) {
    limitadorLogin.registrarFalha(chave);
    throw naoAutorizado('E-mail ou senha inválidos');
  }

  if (Number(cliente.bloqueado)) {
    throw proibido('Conta bloqueada. Entre em contato com o atendimento.');
  }

  limitadorLogin.limpar(chave);

  await db.execute(
    'UPDATE clientes SET ultimo_login_em = NOW() WHERE id = ?',
    [cliente.id]
  );

  return criarSessao(cliente);
}


/* =============================================================
   SENHA E E-MAIL
============================================================= */

/*
  Sempre responde da mesma forma, exista ou não a conta,
  para não revelar quais e-mails estão cadastrados.
*/
async function solicitarRecuperacao(email) {

  if (limitadorRecuperacao.bloqueado(email)) {
    return;
  }

  limitadorRecuperacao.registrarFalha(email);

  const [clientes] = await db.execute(
    'SELECT * FROM clientes WHERE email = ? AND excluido_em IS NULL AND bloqueado = FALSE',
    [email]
  );

  const cliente = clientes[0];

  if (!cliente) {
    return;
  }

  const token = await criarTokenUnico(cliente.id, 'recuperar_senha');
  const mensagem = templates.recuperacaoSenha({ nome: cliente.nome, token });

  try {
    await emailService.enviar({ para: cliente.email, ...mensagem });
  } catch (erro) {
    logger.erro('Falha ao enviar e-mail de recuperação', { erro: erro.message });
  }
}


async function redefinirSenha(token, novaSenha) {

  const clienteId = await consumirTokenUnico(token, 'recuperar_senha');
  const senhaHash = await bcrypt.hash(novaSenha, 12);

  // Quem recebeu o link provou ter acesso ao e-mail
  await db.execute(
    `UPDATE clientes
     SET senha_hash = ?,
         token_versao = token_versao + 1,
         email_verificado_em = COALESCE(email_verificado_em, NOW())
     WHERE id = ?`,
    [senhaHash, clienteId]
  );

  await revogarTodasSessoes(clienteId);
  await vincularPedidosAntigos(clienteId);
}


async function verificarEmail(token) {

  const clienteId = await consumirTokenUnico(token, 'verificar_email');

  await db.execute(
    'UPDATE clientes SET email_verificado_em = NOW() WHERE id = ? AND email_verificado_em IS NULL',
    [clienteId]
  );
  await vincularPedidosAntigos(clienteId);
}


async function reenviarVerificacao(clienteId) {

  const cliente = await buscarPorId(clienteId);

  if (cliente.email_verificado_em) {
    throw requisicaoInvalida('Seu e-mail já está confirmado');
  }

  if (limitadorRecuperacao.bloqueado(`verificacao|${clienteId}`)) {
    throw muitasRequisicoes('Aguarde antes de pedir um novo e-mail de confirmação.');
  }

  limitadorRecuperacao.registrarFalha(`verificacao|${clienteId}`);

  await enviarVerificacao(cliente);
}


/* =============================================================
   PERFIL
============================================================= */

async function perfil(clienteId) {
  return dadosPublicos(await buscarPorId(clienteId));
}


async function atualizarPerfil(clienteId, { nome, telefone }) {

  await db.execute(
    'UPDATE clientes SET nome = ?, telefone = ? WHERE id = ?',
    [nome, telefone, clienteId]
  );

  return perfil(clienteId);
}


async function trocarSenha(clienteId, senhaAtual, senhaNova) {

  const cliente = await buscarPorId(clienteId);

  if (!(await bcrypt.compare(senhaAtual, cliente.senha_hash))) {
    throw requisicaoInvalida('Senha atual incorreta');
  }

  const senhaHash = await bcrypt.hash(senhaNova, 12);

  await db.execute(
    `UPDATE clientes
     SET senha_hash = ?, token_versao = token_versao + 1
     WHERE id = ?`,
    [senhaHash, clienteId]
  );

  // Encerra as outras sessões e devolve uma nova para este dispositivo
  await revogarTodasSessoes(clienteId);

  return criarSessao(await buscarPorId(clienteId));
}


/* =============================================================
   LGPD
============================================================= */

async function exportarDados(clienteId) {

  const cliente = await buscarPorId(clienteId);

  const [enderecos] = await db.execute(
    'SELECT * FROM cliente_enderecos WHERE cliente_id = ?',
    [clienteId]
  );

  const [pedidos] = await db.execute(
    'SELECT * FROM pedidos WHERE cliente_id = ? ORDER BY id DESC',
    [clienteId]
  );

  return {
    gerado_em: new Date().toISOString(),
    conta: {
      ...dadosPublicos(cliente),
      ultimo_login_em: cliente.ultimo_login_em
    },
    enderecos,
    pedidos
  };
}


/*
  Exclusão de conta: remove dados pessoais da conta.
  Os pedidos são mantidos (obrigação fiscal), vinculados a um
  cadastro anonimizado.
*/
async function excluirConta(clienteId, senha) {

  const cliente = await buscarPorId(clienteId);

  if (!(await bcrypt.compare(senha, cliente.senha_hash))) {
    throw requisicaoInvalida('Senha incorreta');
  }

  await db.execute('DELETE FROM cliente_enderecos WHERE cliente_id = ?', [clienteId]);
  await db.execute('DELETE FROM carrinho_itens WHERE cliente_id = ?', [clienteId]);
  await db.execute('DELETE FROM cliente_tokens WHERE cliente_id = ?', [clienteId]);
  await db.execute('DELETE FROM cliente_sessoes WHERE cliente_id = ?', [clienteId]);

  await db.execute(
    `UPDATE clientes
     SET nome = 'Cliente excluído',
         email = ?,
         telefone = NULL,
         senha_hash = ?,
         token_versao = token_versao + 1,
         excluido_em = NOW()
     WHERE id = ?`,
    [
      `excluido-${clienteId}@anonimo.invalid`,
      await bcrypt.hash(tokenAleatorio(), 4),
      clienteId
    ]
  );
}


/* =============================================================
   ADMIN
============================================================= */

async function listarAdmin({ busca = null, limite = 50, pagina = 1 } = {}) {

  const filtros = ['c.excluido_em IS NULL'];
  const valores = [];

  if (busca) {
    filtros.push('(c.nome LIKE ? OR c.email LIKE ? OR c.telefone LIKE ?)');
    valores.push(`%${busca}%`, `%${busca}%`, `%${busca}%`);
  }

  const where = `WHERE ${filtros.join(' AND ')}`;

  const [clientes] = await db.query(
    `SELECT
        c.id,
        c.nome,
        c.email,
        c.telefone,
        c.bloqueado,
        c.email_verificado_em,
        c.criado_em,
        c.ultimo_login_em,
        COUNT(p.id) AS total_pedidos,
        COALESCE(SUM(CASE WHEN p.status NOT IN ('cancelado', 'aguardando_pagamento') THEN p.total END), 0) AS total_gasto,
        MAX(p.criado_em) AS ultimo_pedido_em
     FROM clientes c
     LEFT JOIN pedidos p ON p.cliente_id = c.id
     ${where}
     GROUP BY c.id
     ORDER BY c.criado_em DESC, c.id DESC
     LIMIT ? OFFSET ?`,
    [...valores, limite, (pagina - 1) * limite]
  );

  const [contagem] = await db.query(
    `SELECT COUNT(*) AS total FROM clientes c ${where}`,
    valores
  );

  return {
    clientes,
    total: Number(contagem[0].total),
    pagina,
    limite
  };
}


async function detalheAdmin(clienteId) {

  const cliente = await buscarPorId(clienteId);

  if (!cliente || cliente.excluido_em) {
    throw naoEncontrado('Cliente não encontrado');
  }

  const [enderecos] = await db.execute(
    'SELECT * FROM cliente_enderecos WHERE cliente_id = ? ORDER BY principal DESC, id ASC',
    [clienteId]
  );

  const [pedidos] = await db.execute(
    `SELECT id, status, total, criado_em
     FROM pedidos
     WHERE cliente_id = ?
     ORDER BY id DESC`,
    [clienteId]
  );

  const pagos = pedidos.filter(
    pedido => !['cancelado', 'aguardando_pagamento'].includes(pedido.status)
  );

  const totalGasto = pagos.reduce((total, pedido) => total + Number(pedido.total), 0);

  return {
    ...dadosPublicos(cliente),
    bloqueado: Boolean(Number(cliente.bloqueado)),
    motivo_bloqueio: cliente.motivo_bloqueio,
    ultimo_login_em: cliente.ultimo_login_em,
    enderecos,
    pedidos,
    estatisticas: {
      total_pedidos: pedidos.length,
      pedidos_pagos: pagos.length,
      pedidos_cancelados: pedidos.filter(p => p.status === 'cancelado').length,
      total_gasto: Math.round(totalGasto * 100) / 100,
      ticket_medio: pagos.length ? Math.round((totalGasto / pagos.length) * 100) / 100 : 0,
      primeiro_pedido_em: pedidos.length ? pedidos[pedidos.length - 1].criado_em : null,
      ultimo_pedido_em: pedidos.length ? pedidos[0].criado_em : null
    }
  };
}


async function alterarBloqueio(clienteId, bloqueado, motivo) {

  const [resultado] = await db.execute(
    `UPDATE clientes
     SET bloqueado = ?,
         motivo_bloqueio = ?,
         token_versao = token_versao + ?
     WHERE id = ?
     AND excluido_em IS NULL`,
    [bloqueado, bloqueado ? motivo : null, bloqueado ? 1 : 0, clienteId]
  );

  if (resultado.affectedRows === 0) {
    throw naoEncontrado('Cliente não encontrado');
  }

  if (bloqueado) {
    await revogarTodasSessoes(clienteId);
  }

  return detalheAdmin(clienteId);
}


module.exports = {
  validarSessao,
  cadastrar,
  login,
  renovarSessao,
  encerrarSessao,
  solicitarRecuperacao,
  redefinirSenha,
  verificarEmail,
  reenviarVerificacao,
  perfil,
  atualizarPerfil,
  trocarSenha,
  exportarDados,
  excluirConta,
  listarAdmin,
  detalheAdmin,
  alterarBloqueio,
  limitadorLogin,
  limitadorRecuperacao
};
