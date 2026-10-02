const { Router } = require('express');

const valida = require('../../utils/validacao');
const { autenticarAdmin } = require('../../middlewares/autenticacao');
const estoqueService = require('../../services/estoqueService');

const router = Router();


router.get('/admin/estoque/movimentacoes', autenticarAdmin, async (req, res) => {

  const { variacao_id: variacaoId, produto_id: produtoId, tipo, pagina } = req.query;

  res.json(await estoqueService.listarMovimentacoes({
    variacaoId: variacaoId ? valida.id(variacaoId) : null,
    produtoId: produtoId ? valida.id(produtoId) : null,
    tipo: tipo ? valida.umDe(tipo, estoqueService.TIPOS, 'Tipo inválido') : null,
    pagina: pagina ? valida.inteiro(pagina, 'Página inválida', { min: 1 }) : 1
  }));
});

router.get('/admin/estoque/baixo', autenticarAdmin, async (req, res) => {
  res.json(await estoqueService.listarEstoqueBaixo());
});

router.get('/admin/estoque/inventario', autenticarAdmin, async (req, res) => {
  res.json(await estoqueService.inventario());
});


module.exports = router;
