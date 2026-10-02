const jwt = require('jsonwebtoken');

const config = require('../config/ambiente');
const { naoAutorizado, proibido } = require('../utils/erros');

/*
  Lê e valida o token "Authorization: Bearer <token>".
  O campo "tipo" separa tokens de administradores e de clientes,
  impedindo que um cliente use seu token em rotas do painel.
*/
function lerToken(req, tipoEsperado) {

  const authorization = req.headers.authorization;

  if (!authorization) {
    throw naoAutorizado('Token não fornecido');
  }

  const partes = authorization.split(' ');

  if (partes.length !== 2 || partes[0] !== 'Bearer') {
    throw naoAutorizado('Formato de token inválido');
  }

  let dados;

  try {
    dados = jwt.verify(partes[1], config.jwtSecret);
  } catch (erro) {
    throw naoAutorizado(
      erro.name === 'TokenExpiredError'
        ? 'Token expirado'
        : 'Token inválido'
    );
  }

  // Tokens antigos de admin não têm "tipo": tratados como admin
  const tipo = dados.tipo || 'admin';

  if (tipo !== tipoEsperado) {
    throw naoAutorizado('Token inválido');
  }

  return dados;
}


function autenticarAdmin(req, res, next) {
  req.admin = lerToken(req, 'admin');
  next();
}


/*
  Restringe a rota a determinados perfis de administrador.
  Uso: autorizar('gerente')
*/
function autorizar(...perfis) {

  return (req, res, next) => {

    if (!req.admin || !perfis.includes(req.admin.perfil)) {
      throw proibido('Você não tem permissão para esta ação');
    }

    next();
  };
}


function autenticarCliente(req, res, next) {
  req.cliente = lerToken(req, 'cliente');
  next();
}


// Identifica o cliente se houver token válido, sem exigir login
function identificarCliente(req, res, next) {

  if (req.headers.authorization) {
    try {
      req.cliente = lerToken(req, 'cliente');
    } catch {
      req.cliente = null;
    }
  }

  next();
}


module.exports = {
  autenticarAdmin,
  autorizar,
  autenticarCliente,
  identificarCliente
};
