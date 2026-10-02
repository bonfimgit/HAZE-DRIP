const { Router } = require('express');

const valida = require('../../utils/validacao');
const { autenticarAdmin } = require('../../middlewares/autenticacao');
const categoriasService = require('../../services/categoriasService');

const router = Router();

const NOME_OBRIGATORIO = 'Nome da categoria é obrigatório';


router.get('/admin/categorias', autenticarAdmin, async (req, res) => {
  res.json(await categoriasService.listarTodas());
});

router.post('/categorias', autenticarAdmin, async (req, res) => {
  const nome = valida.texto(req.body?.nome, NOME_OBRIGATORIO, { max: 100 });
  res.status(201).json(await categoriasService.criar(nome));
});

router.put('/categorias/:id', autenticarAdmin, async (req, res) => {
  const id = valida.id(req.params.id);
  const nome = valida.texto(req.body?.nome, NOME_OBRIGATORIO, { max: 100 });
  res.json(await categoriasService.renomear(id, nome));
});

router.delete('/categorias/:id', autenticarAdmin, async (req, res) => {
  await categoriasService.alterarAtivo(valida.id(req.params.id), false);
  res.json({ mensagem: 'Categoria desativada com sucesso' });
});

router.patch('/categorias/:id/reativar', autenticarAdmin, async (req, res) => {
  await categoriasService.alterarAtivo(valida.id(req.params.id), true);
  res.json({ mensagem: 'Categoria reativada com sucesso' });
});


module.exports = router;
