const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = require('../config/db');
const config = require('../config/ambiente');
const {
  naoAutorizado,
  muitasRequisicoes,
  naoEncontrado,
  conflito,
  requisicaoInvalida
} = require('../utils/erros');
const { criarLimitador } = require('../middlewares/limiteTentativas');

const PERFIS = ['gerente', 'operador'];

// 5 tentativas inválidas por IP + e-mail a cada 15 minutos
const limitador = criarLimitador({
  maximo: 5,
  janelaMs: 15 * 60 * 1000
});


function gerarToken(usuario) {
  return jwt.sign(
    {
      tipo: 'admin',
      id: usuario.id,
      email: usuario.email,
      perfil: usuario.perfil,
      tv: usuario.token_versao || 0
    },
    config.jwtSecret,
    { expiresIn: '8h' }
  );
}


function dadosPublicos(usuario) {
  return {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    perfil: usuario.perfil
  };
}


async function login({ email, senha, ip }) {

  const chave = `${ip}|${email}`;

  if (limitador.bloqueado(chave)) {
    throw muitasRequisicoes(
      'Muitas tentativas inválidas. Tente novamente em 15 minutos.'
    );
  }

  const [usuarios] = await db.execute(
    `SELECT *
     FROM usuarios_admin
     WHERE email = ?
     AND ativo = TRUE
     LIMIT 1`,
    [email]
  );

  const usuario = usuarios[0];

  const senhaCorreta = usuario
    ? await bcrypt.compare(senha, usuario.senha_hash)
    : false;

  if (!senhaCorreta) {
    limitador.registrarFalha(chave);
    throw naoAutorizado('E-mail ou senha inválidos');
  }

  limitador.limpar(chave);

  await db.execute(
    'UPDATE usuarios_admin SET ultimo_login_em = NOW() WHERE id = ?',
    [usuario.id]
  );

  return {
    usuario: dadosPublicos(usuario),
    token: gerarToken(usuario)
  };
}


/*
  Confere se o administrador do token ainda está ativo e se o
  token não foi invalidado (troca de senha / desativação).
  Devolve o perfil atual do banco.
*/
async function validarSessao(dadosToken) {

  const [usuarios] = await db.execute(
    `SELECT id, nome, email, perfil, ativo, token_versao
     FROM usuarios_admin
     WHERE id = ?`,
    [dadosToken.id]
  );

  const usuario = usuarios[0];

  if (
    !usuario ||
    !Number(usuario.ativo) ||
    Number(usuario.token_versao) !== Number(dadosToken.tv || 0)
  ) {
    throw naoAutorizado('Sessão expirada. Faça login novamente.');
  }

  return usuario;
}


async function buscarAdmin(id) {

  const [usuarios] = await db.execute(
    `SELECT id, nome, email, perfil
     FROM usuarios_admin
     WHERE id = ?
     AND ativo = TRUE`,
    [id]
  );

  if (usuarios.length === 0) {
    throw naoAutorizado('Usuário administrativo inativo ou removido');
  }

  return usuarios[0];
}


/* =============================================================
   GESTÃO DE ADMINISTRADORES (somente gerente)
============================================================= */

async function listar() {

  const [usuarios] = await db.execute(
    `SELECT id, nome, email, perfil, ativo, criado_em, ultimo_login_em
     FROM usuarios_admin
     ORDER BY nome ASC`
  );

  return usuarios;
}


async function criar({ nome, email, senha, perfil }) {

  const senhaHash = await bcrypt.hash(senha, 12);

  try {

    const [resultado] = await db.execute(
      `INSERT INTO usuarios_admin (nome, email, senha_hash, perfil)
       VALUES (?, ?, ?, ?)`,
      [nome, email, senhaHash, perfil]
    );

    const [usuarios] = await db.execute(
      `SELECT id, nome, email, perfil, ativo, criado_em
       FROM usuarios_admin WHERE id = ?`,
      [resultado.insertId]
    );

    return usuarios[0];

  } catch (erro) {

    if (erro.code === 'ER_DUP_ENTRY') {
      throw conflito('Já existe um administrador com esse e-mail');
    }

    throw erro;
  }
}


async function contarGerentesAtivos(excetoId) {

  const [linhas] = await db.execute(
    `SELECT COUNT(*) AS total
     FROM usuarios_admin
     WHERE perfil = 'gerente'
     AND ativo = TRUE
     AND id <> ?`,
    [excetoId]
  );

  return Number(linhas[0].total);
}


async function atualizar(id, { nome, perfil, ativo }, adminLogadoId) {

  const [usuarios] = await db.execute(
    'SELECT * FROM usuarios_admin WHERE id = ?',
    [id]
  );

  if (usuarios.length === 0) {
    throw naoEncontrado('Administrador não encontrado');
  }

  const atual = usuarios[0];

  if (id === adminLogadoId && (!ativo || perfil !== 'gerente')) {
    throw requisicaoInvalida('Você não pode remover o próprio acesso de gerente');
  }

  const deixaDeSerGerente =
    atual.perfil === 'gerente' &&
    Number(atual.ativo) &&
    (perfil !== 'gerente' || !ativo);

  if (deixaDeSerGerente && (await contarGerentesAtivos(id)) === 0) {
    throw requisicaoInvalida('É preciso manter pelo menos um gerente ativo');
  }

  // Mudança de perfil ou desativação encerra as sessões abertas
  const invalidar = perfil !== atual.perfil || (!ativo && Number(atual.ativo));

  await db.execute(
    `UPDATE usuarios_admin
     SET nome = ?, perfil = ?, ativo = ?,
         token_versao = token_versao + ?
     WHERE id = ?`,
    [nome, perfil, ativo, invalidar ? 1 : 0, id]
  );

  const [atualizados] = await db.execute(
    `SELECT id, nome, email, perfil, ativo, criado_em, ultimo_login_em
     FROM usuarios_admin WHERE id = ?`,
    [id]
  );

  return atualizados[0];
}


async function definirSenha(id, senha) {

  const senhaHash = await bcrypt.hash(senha, 12);

  const [resultado] = await db.execute(
    `UPDATE usuarios_admin
     SET senha_hash = ?, token_versao = token_versao + 1
     WHERE id = ?`,
    [senhaHash, id]
  );

  if (resultado.affectedRows === 0) {
    throw naoEncontrado('Administrador não encontrado');
  }
}


async function trocarPropriaSenha(id, senhaAtual, senhaNova) {

  const [usuarios] = await db.execute(
    'SELECT * FROM usuarios_admin WHERE id = ?',
    [id]
  );

  const usuario = usuarios[0];

  if (!usuario || !(await bcrypt.compare(senhaAtual, usuario.senha_hash))) {
    throw requisicaoInvalida('Senha atual incorreta');
  }

  await definirSenha(id, senhaNova);

  // Novo token para continuar logado após invalidar os antigos
  const [atualizados] = await db.execute(
    'SELECT * FROM usuarios_admin WHERE id = ?',
    [id]
  );

  return gerarToken(atualizados[0]);
}


module.exports = {
  PERFIS,
  login,
  validarSessao,
  buscarAdmin,
  listar,
  criar,
  atualizar,
  definirSenha,
  trocarPropriaSenha,
  limitador
};
