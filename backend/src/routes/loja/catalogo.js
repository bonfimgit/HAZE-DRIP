const { Router } = require('express');

const valida = require('../../utils/validacao');
const produtosService = require('../../services/produtosService');
const imagensService = require('../../services/imagensService');
const variacoesService = require('../../services/variacoesService');
const categoriasService = require('../../services/categoriasService');
const campanhasService = require('../../services/campanhasService');
const catalogoService = require('../../services/catalogoService');
const avaliacoesService = require('../../services/avaliacoesService');
const { cachePublico } = require('../../middlewares/cache');

const router = Router();

const ID_PRODUTO = 'ID do produto inválido';


/* =============================================================
   CATÁLOGO COM BUSCA, FILTROS E PAGINAÇÃO
   /catalogo?busca=moletom&categoria=1,2&tamanho=M&cor=Preto
            &preco_min=50&preco_max=300&ordem=menor_preco&pagina=2
============================================================= */

function lista(valor, max = 20) {
  if (valor == null || valor === '') return undefined;
  const itens = String(valor).split(',').map(item => item.trim()).filter(Boolean);
  return itens.length ? itens.slice(0, max) : undefined;
}

router.get('/catalogo', cachePublico(60), async (req, res) => {

  const q = req.query;

  const precoOpcional = (valor, mensagem) =>
    valor == null || valor === '' ? null : valida.dinheiro(valor, mensagem, { min: 0 });

  res.json(await catalogoService.buscar({
    busca: q.busca ? valida.texto(q.busca, 'Busca inválida', { max: 100 }) : null,
    categorias: lista(q.categoria)?.map(id => valida.id(id, 'Categoria inválida')),
    tamanhos: lista(q.tamanho)?.map(t => valida.texto(t, 'Tamanho inválido', { max: 20 })),
    cores: lista(q.cor)?.map(c => valida.texto(c, 'Cor inválida', { max: 50 })),
    precoMin: precoOpcional(q.preco_min, 'Preço mínimo inválido'),
    precoMax: precoOpcional(q.preco_max, 'Preço máximo inválido'),
    promocao: valida.paraBoolean(q.promocao),
    disponivel: valida.paraBoolean(q.disponivel),
    ordem: q.ordem ? valida.umDe(q.ordem, Object.keys(catalogoService.ORDENS), 'Ordenação inválida') : 'recentes',
    pagina: q.pagina ? valida.inteiro(q.pagina, 'Página inválida', { min: 1, max: 1000 }) : 1,
    limite: q.limite ? valida.inteiro(q.limite, 'Limite inválido', { min: 1, max: catalogoService.MAX_LIMITE }) : 12
  }));
});

router.get('/catalogo/filtros', cachePublico(300), async (req, res) => {
  res.json(await catalogoService.facetas());
});

router.get('/produtos', cachePublico(60), async (req, res) => {
  res.json(await produtosService.listarAtivos());
});

// Precisa vir antes de /produtos/:id
router.get('/produtos/destaques', cachePublico(60), async (req, res) => {
  res.json(await produtosService.listarDestaques());
});

router.get('/produtos/:id', cachePublico(30), async (req, res) => {
  const produtoId = valida.id(req.params.id, ID_PRODUTO);
  res.json(await produtosService.buscarAtivo(produtoId));
});

router.get('/produtos/:id/relacionados', cachePublico(300), async (req, res) => {
  const produtoId = valida.id(req.params.id, ID_PRODUTO);
  res.json(await catalogoService.relacionados(produtoId));
});

router.get('/produtos/:id/avaliacoes', cachePublico(60), async (req, res) => {
  const produtoId = valida.id(req.params.id, ID_PRODUTO);
  res.json(await avaliacoesService.resumoProduto(produtoId, {
    pagina: req.query.pagina ? valida.inteiro(req.query.pagina, 'Página inválida', { min: 1 }) : 1
  }));
});

router.get('/produtos/:id/imagens', async (req, res) => {
  const produtoId = valida.id(req.params.id, ID_PRODUTO);
  res.json(await imagensService.listar(produtoId));
});

router.get('/produtos/:id/variacoes', async (req, res) => {
  const produtoId = valida.id(req.params.id, ID_PRODUTO);
  res.json(await variacoesService.listarAtivas(produtoId));
});

router.get('/categorias', cachePublico(300), async (req, res) => {
  res.json(await categoriasService.listarAtivas());
});

router.get('/campanha', cachePublico(60), async (req, res) => {
  res.json(await campanhasService.buscarAtivaLoja());
});


module.exports = router;
