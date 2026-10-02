const { Router } = require('express');

const valida = require('../../utils/validacao');
const { requisicaoInvalida } = require('../../utils/erros');
const { autenticarAdmin } = require('../../middlewares/autenticacao');
const pedidosService = require('../../services/pedidosService');

const router = Router();

const ID_PEDIDO = 'ID do pedido inválido';


function lerRastreio(corpo) {

  const { codigo_rastreio: codigo, transportadora, url_rastreio: url } = corpo || {};

  if (codigo == null && transportadora == null && url == null) {
    return null;
  }

  const urlRastreio = valida.texto(url, 'URL de rastreio inválida', { max: 255, opcional: true });

  if (urlRastreio && !/^https?:\/\//i.test(urlRastreio)) {
    throw requisicaoInvalida('URL de rastreio inválida');
  }

  return {
    codigo: valida.texto(codigo, 'Código de rastreio inválido', { max: 60, opcional: true }),
    transportadora: valida.texto(transportadora, 'Transportadora inválida', { max: 60, opcional: true }),
    url: urlRastreio
  };
}


router.get('/admin/pedidos', autenticarAdmin, async (req, res) => {

  const status = req.query.status
    ? valida.umDe(req.query.status, pedidosService.STATUS, 'Status inválido')
    : null;

  const busca = req.query.busca
    ? valida.texto(req.query.busca, 'Busca inválida', { max: 100 })
    : null;

  res.json(await pedidosService.listarAdmin({ status, busca }));
});

router.get('/admin/pedidos/:id', autenticarAdmin, async (req, res) => {
  const pedidoId = valida.id(req.params.id, ID_PEDIDO);
  res.json(await pedidosService.buscarCompleto(pedidoId));
});

router.patch('/admin/pedidos/:id/status', autenticarAdmin, async (req, res) => {

  const pedidoId = valida.id(req.params.id, ID_PEDIDO);
  const { status, observacao } = req.body || {};

  const pedido = await pedidosService.avancarStatus(pedidoId, status, {
    adminId: req.admin.id,
    origem: 'admin',
    observacao: valida.texto(observacao, 'Observação inválida', { max: 255, opcional: true }),
    rastreio: lerRastreio(req.body)
  });

  res.json({
    mensagem: 'Status atualizado com sucesso',
    pedido
  });
});

router.patch('/admin/pedidos/:id/rastreio', autenticarAdmin, async (req, res) => {

  const pedidoId = valida.id(req.params.id, ID_PEDIDO);
  const rastreio = lerRastreio(req.body);

  if (!rastreio) {
    throw requisicaoInvalida('Informe os dados de rastreio');
  }

  await pedidosService.atualizarRastreio(pedidoId, rastreio);

  res.json({
    mensagem: 'Rastreio atualizado com sucesso',
    pedido: await pedidosService.buscarCompleto(pedidoId)
  });
});

router.patch('/admin/pedidos/:id/cancelar', autenticarAdmin, async (req, res) => {

  const pedidoId = valida.id(req.params.id, ID_PEDIDO);

  const pedido = await pedidosService.cancelar(pedidoId, {
    adminId: req.admin.id,
    origem: 'admin',
    motivo: valida.texto(req.body?.motivo, 'Motivo inválido', { max: 255, opcional: true })
  });

  res.json({
    mensagem: 'Pedido cancelado e estoque devolvido com sucesso',
    pedido
  });
});


module.exports = router;
