const { Router } = require('express');

const valida = require('../../utils/validacao');
const { requisicaoInvalida } = require('../../utils/erros');
const { autenticarAdmin } = require('../../middlewares/autenticacao');
const adminAuthService = require('../../services/adminAuthService');

const router = Router();


router.post('/admin/login', async (req, res) => {

  const { email, senha } = req.body || {};

  if (
    typeof email !== 'string' ||
    typeof senha !== 'string' ||
    !email.trim() ||
    !senha
  ) {
    throw requisicaoInvalida('E-mail e senha são obrigatórios');
  }

  const { usuario, token } = await adminAuthService.login({
    email: email.trim().toLowerCase(),
    senha,
    ip: req.ip
  });

  res.json({
    mensagem: 'Login realizado com sucesso',
    usuario,
    // "admin" mantém compatibilidade com o painel
    admin: usuario,
    token
  });
});


// Dados do administrador logado (valida o token salvo no painel)
router.get('/admin/me', autenticarAdmin, async (req, res) => {
  res.json(await adminAuthService.buscarAdmin(req.admin.id));
});


module.exports = router;
