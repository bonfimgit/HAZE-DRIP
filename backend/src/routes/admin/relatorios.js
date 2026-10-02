const { Router } = require('express');

const valida = require('../../utils/validacao');
const { requisicaoInvalida } = require('../../utils/erros');
const { autenticarAdmin, autorizar } = require('../../middlewares/autenticacao');
const relatoriosService = require('../../services/relatoriosService');

const router = Router();


function lerFiltro(query) {

  const data = (valor, nome) => {
    if (!valor) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
      throw requisicaoInvalida(`${nome} inválida`);
    }
    return valor;
  };

  return {
    de: data(query.de, 'Data inicial'),
    ate: data(query.ate, 'Data final')
  };
}


// Painel inicial: todos os administradores
router.get('/admin/relatorios/dashboard', autenticarAdmin, async (req, res) => {
  res.json(await relatoriosService.dashboard(lerFiltro(req.query)));
});

// Exportação CSV: somente gerente (dados pessoais e financeiros)
router.get('/admin/relatorios/exportar/:tipo', autenticarAdmin, autorizar('gerente'), async (req, res) => {

  const tipo = valida.umDe(req.params.tipo, relatoriosService.TIPOS_EXPORTACAO, 'Relatório inválido');
  const csv = await relatoriosService.exportar(tipo, lerFiltro(req.query));

  const data = new Date().toISOString().slice(0, 10);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="haze-drip-${tipo}-${data}.csv"`);
  res.send(csv);
});


module.exports = router;
