const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = require('../config/db');
const config = require('../config/ambiente');
const { naoAutorizado, muitasRequisicoes } = require('../utils/erros');
const { criarLimitador } = require('../middlewares/limiteTentativas');

// 5 tentativas inválidas por IP + e-mail a cada 15 minutos
const limitador = criarLimitador({
  maximo: 5,
  janelaMs: 15 * 60 * 1000
});


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

  const token = jwt.sign(
    {
      tipo: 'admin',
      id: usuario.id,
      email: usuario.email,
      perfil: usuario.perfil
    },
    config.jwtSecret,
    { expiresIn: '8h' }
  );

  return {
    usuario: {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      perfil: usuario.perfil
    },
    token
  };
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


module.exports = {
  login,
  buscarAdmin,
  limitador
};
