const db = require('../config/db');
const logger = require('../utils/logger');

const METODOS_AUDITADOS = ['POST', 'PUT', 'PATCH', 'DELETE'];

/*
  Registra ações de escrita bem-sucedidas feitas por administradores.
  Não grava o corpo da requisição (pode conter senhas).
*/
function auditoria(req, res, next) {

  if (!METODOS_AUDITADOS.includes(req.method)) {
    return next();
  }

  res.on('finish', () => {

    if (!req.admin || res.statusCode >= 400) {
      return;
    }

    db.execute(
      `INSERT INTO auditoria_admin
        (admin_id, admin_email, metodo, rota, status_http, ip)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        req.admin.id || null,
        req.admin.email || null,
        req.method,
        req.originalUrl.slice(0, 255),
        res.statusCode,
        req.ip || null
      ]
    ).catch(erro => {
      logger.erro('Erro ao registrar auditoria', { erro: erro.message });
    });
  });

  next();
}

module.exports = { auditoria };
