/*
  Frete, cupons, pagamentos e reembolsos no painel.
*/

const { Router } = require('express');

const valida = require('../../utils/validacao');
const { requisicaoInvalida } = require('../../utils/erros');
const { autenticarAdmin, autorizar } = require('../../middlewares/autenticacao');
const freteService = require('../../services/freteService');
const cuponsService = require('../../services/cuponsService');
const pagamentosService = require('../../services/pagamentosService');
const db = require('../../config/db');

const router = Router();


/* =============================================================
   FRETE
============================================================= */

function lerCepOpcional(valor, mensagem) {
  if (valor == null || valor === '') return null;
  return valida.cep(valor, mensagem).replace('-', '');
}

function lerRegraFrete(corpo) {

  const dados = corpo || {};

  const cepInicio = lerCepOpcional(dados.cep_inicio, 'CEP inicial inválido');
  const cepFim = lerCepOpcional(dados.cep_fim, 'CEP final inválido');

  if (Boolean(cepInicio) !== Boolean(cepFim)) {
    throw requisicaoInvalida('Informe o CEP inicial e o final da faixa');
  }

  if (cepInicio && cepInicio > cepFim) {
    throw requisicaoInvalida('O CEP inicial deve ser menor que o final');
  }

  const prazoMin = valida.inteiro(dados.prazo_min_dias, 'Prazo mínimo inválido', { min: 0, max: 120 });
  const prazoMax = valida.inteiro(dados.prazo_max_dias, 'Prazo máximo inválido', { min: 0, max: 120 });

  if (prazoMax < prazoMin) {
    throw requisicaoInvalida('O prazo máximo deve ser maior ou igual ao mínimo');
  }

  return {
    nome: valida.texto(dados.nome, 'Nome da regra é obrigatório', { max: 100 }),
    uf: dados.uf ? valida.uf(dados.uf) : null,
    cepInicio,
    cepFim,
    valor: valida.dinheiro(dados.valor, 'Valor do frete inválido', { min: 0 }),
    prazoMin,
    prazoMax,
    gratisAcima: dados.gratis_acima == null || dados.gratis_acima === ''
      ? null
      : valida.dinheiro(dados.gratis_acima, 'Valor para frete grátis inválido', { min: 0 }),
    ativo: dados.ativo == null ? true : valida.paraBoolean(dados.ativo)
  };
}

router.get('/admin/frete', autenticarAdmin, async (req, res) => {
  res.json(await freteService.listar());
});

router.post('/admin/frete', autenticarAdmin, async (req, res) => {
  res.status(201).json(await freteService.salvar(null, lerRegraFrete(req.body)));
});

router.put('/admin/frete/:id', autenticarAdmin, async (req, res) => {
  res.json(await freteService.salvar(valida.id(req.params.id), lerRegraFrete(req.body)));
});

router.delete('/admin/frete/:id', autenticarAdmin, async (req, res) => {
  await freteService.remover(valida.id(req.params.id));
  res.json({ mensagem: 'Regra removida' });
});

// Simulador: qual regra atende um CEP
router.get('/admin/frete/simular', autenticarAdmin, async (req, res) => {
  res.json(await freteService.calcular({
    cep: valida.cep(req.query.cep),
    uf: req.query.uf ? valida.uf(req.query.uf) : null,
    valorProdutos: req.query.valor ? valida.dinheiro(req.query.valor, 'Valor inválido', { min: 0 }) : 0
  }));
});


/* =============================================================
   CUPONS
============================================================= */

function lerCupom(corpo) {

  const dados = corpo || {};

  const tipo = valida.umDe(dados.tipo, cuponsService.TIPOS, 'Tipo de cupom inválido');

  const codigo = valida.texto(dados.codigo, 'Código é obrigatório', { max: 40, min: 3 });

  if (!/^[A-Za-z0-9_-]+$/.test(codigo)) {
    throw requisicaoInvalida('O código deve ter apenas letras, números, - ou _');
  }

  let valor = 0;

  if (tipo === 'percentual') {
    valor = valida.dinheiro(dados.valor, 'Percentual deve ser entre 1 e 100', { min: 1, max: 100 });
  } else if (tipo === 'fixo') {
    valor = valida.dinheiro(dados.valor, 'Valor do desconto inválido', { min: 0.01 });
  }

  const inicioEm = valida.data(dados.inicio_em, 'Data inicial inválida', { opcional: true });
  const fimEm = valida.data(dados.fim_em, 'Data final inválida', { opcional: true });

  if (inicioEm && fimEm && fimEm <= inicioEm) {
    throw requisicaoInvalida('A data final deve ser depois da inicial');
  }

  const inteiroOpcional = (v, msg) =>
    v == null || v === '' ? null : valida.inteiro(v, msg, { min: 1, max: 1000000 });

  return {
    codigo,
    descricao: valida.texto(dados.descricao, 'Descrição inválida', { max: 255, opcional: true }),
    tipo,
    valor,
    valorMinimo: dados.valor_minimo == null || dados.valor_minimo === ''
      ? null
      : valida.dinheiro(dados.valor_minimo, 'Valor mínimo inválido', { min: 0 }),
    inicioEm,
    fimEm,
    limiteTotal: inteiroOpcional(dados.limite_uso_total, 'Limite total inválido'),
    limitePorCliente: inteiroOpcional(dados.limite_por_cliente, 'Limite por cliente inválido'),
    ativo: dados.ativo == null ? true : valida.paraBoolean(dados.ativo)
  };
}

router.get('/admin/cupons', autenticarAdmin, async (req, res) => {
  res.json(await cuponsService.listar());
});

router.post('/admin/cupons', autenticarAdmin, async (req, res) => {
  res.status(201).json(await cuponsService.salvar(null, lerCupom(req.body)));
});

router.put('/admin/cupons/:id', autenticarAdmin, async (req, res) => {
  res.json(await cuponsService.salvar(valida.id(req.params.id), lerCupom(req.body)));
});


/* =============================================================
   PAGAMENTOS E REEMBOLSOS
============================================================= */

router.get('/admin/pedidos/:id/pagamentos', autenticarAdmin, async (req, res) => {

  const [pagamentos] = await db.execute(
    `SELECT id, provedor, provedor_id, tipo, metodo, status, status_detalhe,
            valor, valor_reembolsado, expira_em, criado_em, atualizado_em
     FROM pagamentos
     WHERE pedido_id = ?
     ORDER BY id DESC`,
    [valida.id(req.params.id)]
  );

  res.json(pagamentos);
});

// Consulta o Mercado Pago de novo (caso um webhook tenha se perdido)
router.post('/admin/pedidos/:id/pagamentos/sincronizar', autenticarAdmin, async (req, res) => {

  const [pagamentos] = await db.execute(
    `SELECT provedor_id FROM pagamentos
     WHERE pedido_id = ? AND tipo = 'pagamento' AND provedor_id IS NOT NULL`,
    [valida.id(req.params.id)]
  );

  const resultados = [];

  for (const pagamento of pagamentos) {
    resultados.push(await pagamentosService.sincronizar(pagamento.provedor_id));
  }

  res.json({ resultados });
});

// Reembolso: somente gerente
router.post('/admin/pedidos/:id/reembolso', autenticarAdmin, autorizar('gerente'), async (req, res) => {

  const { valor, motivo } = req.body || {};

  res.json(await pagamentosService.reembolsar(valida.id(req.params.id), {
    valor: valor == null || valor === '' ? null : valida.dinheiro(valor, 'Valor inválido'),
    motivo: valida.texto(motivo, 'Motivo inválido', { max: 255, opcional: true }),
    adminId: req.admin.id
  }));
});


module.exports = router;
