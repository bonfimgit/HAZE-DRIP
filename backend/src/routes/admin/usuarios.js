const { Router } = require('express');

const valida = require('../../utils/validacao');
const { autenticarAdmin, autorizar } = require('../../middlewares/autenticacao');
const adminAuthService = require('../../services/adminAuthService');

const router = Router();

const somenteGerente = [autenticarAdmin, autorizar('gerente')];


router.get('/admin/usuarios', ...somenteGerente, async (req, res) => {
  res.json(await adminAuthService.listar());
});

router.post('/admin/usuarios', ...somenteGerente, async (req, res) => {

  const { nome, email, senha, perfil } = req.body || {};

  const usuario = await adminAuthService.criar({
    nome: valida.texto(nome, 'Nome é obrigatório', { max: 100 }),
    email: valida.email(email),
    senha: valida.senha(senha),
    perfil: valida.umDe(perfil, adminAuthService.PERFIS, 'Perfil inválido')
  });

  res.status(201).json(usuario);
});

router.put('/admin/usuarios/:id', ...somenteGerente, async (req, res) => {

  const { nome, perfil, ativo } = req.body || {};

  const usuario = await adminAuthService.atualizar(
    valida.id(req.params.id),
    {
      nome: valida.texto(nome, 'Nome é obrigatório', { max: 100 }),
      perfil: valida.umDe(perfil, adminAuthService.PERFIS, 'Perfil inválido'),
      ativo: valida.paraBoolean(valida.obrigatorio(ativo, 'Informe se o usuário está ativo'))
    },
    req.admin.id
  );

  res.json(usuario);
});

router.patch('/admin/usuarios/:id/senha', ...somenteGerente, async (req, res) => {
  await adminAuthService.definirSenha(
    valida.id(req.params.id),
    valida.senha(req.body?.senha)
  );
  res.json({ mensagem: 'Senha redefinida. As sessões abertas desse usuário foram encerradas.' });
});

// Qualquer administrador troca a própria senha
router.patch('/admin/me/senha', autenticarAdmin, async (req, res) => {

  const { senha_atual: senhaAtual, senha_nova: senhaNova } = req.body || {};

  const token = await adminAuthService.trocarPropriaSenha(
    req.admin.id,
    valida.texto(senhaAtual, 'Informe a senha atual', { max: 128 }),
    valida.senha(senhaNova)
  );

  res.json({
    mensagem: 'Senha alterada com sucesso',
    token
  });
});


module.exports = router;
