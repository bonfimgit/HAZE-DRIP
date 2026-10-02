const { Router } = require('express');

const valida = require('../../utils/validacao');
const { autenticarAdmin } = require('../../middlewares/autenticacao');
const clientesService = require('../../services/clientesService');

const router = Router();


router.get('/admin/clientes', autenticarAdmin, async (req, res) => {

  const { busca, pagina } = req.query;

  res.json(await clientesService.listarAdmin({
    busca: busca ? valida.texto(busca, 'Busca inválida', { max: 100 }) : null,
    pagina: pagina ? valida.inteiro(pagina, 'Página inválida', { min: 1 }) : 1
  }));
});

router.get('/admin/clientes/:id', autenticarAdmin, async (req, res) => {
  res.json(await clientesService.detalheAdmin(valida.id(req.params.id)));
});

router.patch('/admin/clientes/:id/bloqueio', autenticarAdmin, async (req, res) => {

  const { bloqueado, motivo } = req.body || {};

  res.json(await clientesService.alterarBloqueio(
    valida.id(req.params.id),
    valida.paraBoolean(valida.obrigatorio(bloqueado, 'Informe se o cliente está bloqueado')),
    valida.texto(motivo, 'Motivo inválido', { max: 255, opcional: true })
  ));
});


module.exports = router;
