const { Router } = require('express');

const valida = require('../../utils/validacao');
const produtosService = require('../../services/produtosService');
const imagensService = require('../../services/imagensService');
const variacoesService = require('../../services/variacoesService');
const categoriasService = require('../../services/categoriasService');
const campanhasService = require('../../services/campanhasService');

const router = Router();

const ID_PRODUTO = 'ID do produto inválido';


router.get('/produtos', async (req, res) => {
  res.json(await produtosService.listarAtivos());
});

// Precisa vir antes de /produtos/:id
router.get('/produtos/destaques', async (req, res) => {
  res.json(await produtosService.listarDestaques());
});

router.get('/produtos/:id', async (req, res) => {
  const produtoId = valida.id(req.params.id, ID_PRODUTO);
  res.json(await produtosService.buscarAtivo(produtoId));
});

router.get('/produtos/:id/imagens', async (req, res) => {
  const produtoId = valida.id(req.params.id, ID_PRODUTO);
  res.json(await imagensService.listar(produtoId));
});

router.get('/produtos/:id/variacoes', async (req, res) => {
  const produtoId = valida.id(req.params.id, ID_PRODUTO);
  res.json(await variacoesService.listarAtivas(produtoId));
});

router.get('/categorias', async (req, res) => {
  res.json(await categoriasService.listarAtivas());
});

router.get('/campanha', async (req, res) => {
  res.json(await campanhasService.buscarAtivaLoja());
});


module.exports = router;
