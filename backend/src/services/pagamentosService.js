/*
  Pagamentos via Mercado Pago.

  Fluxo:
    checkout -> pedido criado (aguardando_pagamento)
             -> iniciar(): cria PIX ou link do Checkout Pro
             -> cliente paga
             -> webhook -> sincronizar(): consulta o pagamento na API
             -> aprovado e valor confere -> pedido "pago"

  Nunca confiamos no corpo do webhook: o status é sempre buscado
  na API do Mercado Pago com o nosso token.
*/

const db = require('../config/db');
const config = require('../config/ambiente');
const mercadoPago = require('../integracoes/mercadoPago');
const { emTransacao } = require('../utils/transacao');
const { naoEncontrado, requisicaoInvalida, conflito } = require('../utils/erros');
const { arredondar } = require('../utils/dinheiro');
const logger = require('../utils/logger');
const pedidosService = require('./pedidosService');

const METODOS = ['pix', 'mercadopago'];

// Prazo para pagar antes de o pedido ser cancelado e o estoque devolvido
const PRAZO_MINUTOS = {
  pix: 30,
  mercadopago: 3 * 24 * 60 // cobre o prazo do boleto
};


function urlNotificacao() {
  // O Mercado Pago só aceita notificação em endereço público https
  return /^https:\/\//.test(config.urlApi)
    ? `${config.urlApi}/pagamentos/webhook/mercadopago`
    : null;
}


function urlRetorno(pedido) {
  return config.urlLoja
    ? `${config.urlLoja}/pedido-confirmado.html?pedido=${pedido.id}&token=${pedido.token_acesso}`
    : null;
}


async function buscarPedido(pedidoId) {

  const [pedidos] = await db.execute('SELECT * FROM pedidos WHERE id = ?', [pedidoId]);

  if (pedidos.length === 0) {
    throw naoEncontrado('Pedido não encontrado');
  }

  return pedidos[0];
}


/*
  Cria a cobrança de um pedido aguardando pagamento.
  Pode ser chamada de novo (ex.: PIX expirou ou trocou o método).
*/
async function iniciar(pedidoId, metodo) {

  if (!METODOS.includes(metodo)) {
    throw requisicaoInvalida('Forma de pagamento inválida');
  }

  const pedido = await buscarPedido(pedidoId);

  if (pedido.status !== 'aguardando_pagamento') {
    throw conflito('Este pedido não está aguardando pagamento');
  }

  const expiraEm = new Date(Date.now() + PRAZO_MINUTOS[metodo] * 60 * 1000);
  const valor = Number(pedido.total);

  const dadosComuns = {
    pedidoId: pedido.id,
    valor,
    descricao: `Pedido #${pedido.id} — Haze Drip`,
    email: pedido.cliente_email,
    nome: pedido.cliente_nome.split(' ')[0],
    expiraEm,
    urlNotificacao: urlNotificacao(),
    // Mesma chave = mesma cobrança, mesmo se a requisição for repetida
    chaveIdempotencia: `pedido-${pedido.id}-${metodo}-${Math.floor(Date.now() / 60000)}`
  };

  let cobranca;

  if (metodo === 'pix') {
    cobranca = await mercadoPago.criarPix(dadosComuns);
  } else {
    cobranca = await mercadoPago.criarPreferencia({
      ...dadosComuns,
      urlRetorno: urlRetorno(pedido)
    });
  }

  await db.execute(
    `INSERT INTO pagamentos
      (pedido_id, provedor, provedor_id, tipo, metodo, status, status_detalhe,
       valor, pix_qr_code, pix_qr_code_base64, url, expira_em)
     VALUES (?, 'mercadopago', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      pedido.id,
      cobranca.id,
      metodo === 'pix' ? 'pagamento' : 'preferencia',
      metodo === 'pix' ? 'pix' : null,
      cobranca.status || 'pendente',
      cobranca.status_detalhe || null,
      valor,
      cobranca.qr_code || null,
      cobranca.qr_code_base64 || null,
      cobranca.url || null,
      expiraEm
    ]
  );

  await db.execute(
    `UPDATE pedidos
     SET metodo_pagamento = ?,
         pagamento_status = 'pendente',
         pagamento_url = ?,
         pagamento_expira_em = ?
     WHERE id = ?`,
    [metodo, cobranca.url || null, expiraEm, pedido.id]
  );

  return {
    metodo,
    status: 'pendente',
    url: cobranca.url || null,
    pix_qr_code: cobranca.qr_code || null,
    pix_qr_code_base64: cobranca.qr_code_base64 || null,
    expira_em: expiraEm
  };
}


/*
  Dados de pagamento para a tela de confirmação do pedido.
*/
async function resumo(pedidoId) {

  const [pagamentos] = await db.execute(
    `SELECT tipo, metodo, status, url, pix_qr_code, pix_qr_code_base64, expira_em
     FROM pagamentos
     WHERE pedido_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [pedidoId]
  );

  return pagamentos[0] || null;
}


const STATUS_PAGAMENTO = {
  approved: 'aprovado',
  authorized: 'pendente',
  pending: 'pendente',
  in_process: 'em_analise',
  in_mediation: 'em_disputa',
  rejected: 'recusado',
  cancelled: 'cancelado',
  refunded: 'reembolsado',
  charged_back: 'estornado'
};


/*
  Consulta um pagamento no Mercado Pago e aplica o resultado ao pedido.
  Chamado pelo webhook, pela expiração e manualmente pelo admin.
*/
async function sincronizar(pagamentoId) {

  const pagamento = await mercadoPago.buscarPagamento(pagamentoId);

  if (!Number.isInteger(pagamento.pedido_id) || pagamento.pedido_id <= 0) {
    return { resultado: 'pagamento sem pedido vinculado' };
  }

  const pedido = await buscarPedido(pagamento.pedido_id);
  const statusLocal = STATUS_PAGAMENTO[pagamento.status] || pagamento.status;

  // Registra/atualiza o pagamento (no Checkout Pro ele nasce no MP)
  const [existentes] = await db.execute(
    `SELECT id FROM pagamentos
     WHERE provedor = 'mercadopago' AND provedor_id = ? AND tipo = 'pagamento'`,
    [pagamento.id]
  );

  if (existentes.length) {
    await db.execute(
      `UPDATE pagamentos
       SET status = ?, status_detalhe = ?, metodo = ?, valor_reembolsado = ?
       WHERE id = ?`,
      [statusLocal, pagamento.status_detalhe, pagamento.metodo, pagamento.valor_reembolsado, existentes[0].id]
    );
  } else {
    await db.execute(
      `INSERT INTO pagamentos
        (pedido_id, provedor, provedor_id, tipo, metodo, status, status_detalhe, valor, valor_reembolsado)
       VALUES (?, 'mercadopago', ?, 'pagamento', ?, ?, ?, ?, ?)`,
      [pedido.id, pagamento.id, pagamento.metodo, statusLocal, pagamento.status_detalhe, pagamento.valor, pagamento.valor_reembolsado]
    );
  }

  /* ---------- Aprovado ---------- */

  if (pagamento.status === 'approved') {

    // Valor pago precisa bater com o total do pedido
    if (arredondar(pagamento.valor) < arredondar(pedido.total)) {

      await db.execute(
        "UPDATE pedidos SET pagamento_status = 'valor_divergente' WHERE id = ?",
        [pedido.id]
      );

      logger.erro('Pagamento com valor menor que o pedido', {
        pedidoId: pedido.id,
        pago: pagamento.valor,
        total: pedido.total
      });

      return { resultado: 'valor divergente' };
    }

    if (pedido.status === 'aguardando_pagamento') {

      await db.execute(
        "UPDATE pedidos SET pagamento_status = 'aprovado' WHERE id = ?",
        [pedido.id]
      );

      await pedidosService.avancarStatus(pedido.id, 'pago', {
        origem: 'pagamento',
        observacao: `Mercado Pago #${pagamento.id} (${pagamento.metodo || 'pagamento'})`
      });

      return { resultado: 'pedido pago' };
    }

    if (pedido.status === 'cancelado') {

      // Pagou depois que o pedido expirou: precisa de ação manual
      await db.execute(
        "UPDATE pedidos SET pagamento_status = 'aprovado_apos_cancelamento' WHERE id = ?",
        [pedido.id]
      );

      logger.erro('Pagamento aprovado para pedido cancelado — reembolsar', {
        pedidoId: pedido.id,
        pagamentoId: pagamento.id
      });

      return { resultado: 'aprovado após cancelamento' };
    }

    return { resultado: 'já processado' };
  }

  /* ---------- Reembolsado / estornado ---------- */

  if (['refunded', 'charged_back'].includes(pagamento.status)) {

    await db.execute(
      `UPDATE pedidos
       SET pagamento_status = ?,
           valor_reembolsado = ?,
           reembolsado_em = COALESCE(reembolsado_em, NOW())
       WHERE id = ?`,
      [statusLocal, pagamento.valor_reembolsado || pagamento.valor, pedido.id]
    );

    if (pedidosService.STATUS_CANCELAVEIS.includes(pedido.status)) {
      await pedidosService.cancelar(pedido.id, {
        origem: 'pagamento',
        motivo: pagamento.status === 'charged_back' ? 'Estorno (chargeback)' : 'Pagamento reembolsado'
      });
    }

    return { resultado: statusLocal };
  }

  /* ---------- Demais status ---------- */

  if (pedido.status === 'aguardando_pagamento') {
    await db.execute(
      'UPDATE pedidos SET pagamento_status = ? WHERE id = ?',
      [statusLocal, pedido.id]
    );
  }

  return { resultado: statusLocal };
}


/*
  Webhook do Mercado Pago.
  Responde rápido e registra o evento; erros não derrubam a resposta,
  para o MP não ficar reenviando indefinidamente notificações inválidas.
*/
async function processarWebhook({ tipo, recursoId, assinatura, requestId }) {

  const assinaturaValida = mercadoPago.validarAssinatura({
    assinatura,
    requestId,
    dataId: recursoId
  });

  let resultado = 'ignorado';

  try {

    if (assinaturaValida === false) {
      resultado = 'assinatura inválida';
    } else if (tipo === 'payment' && recursoId) {
      if (assinaturaValida === null) {
        logger.aviso('MERCADOPAGO_WEBHOOK_SECRET não configurado: assinatura não verificada');
      }
      resultado = (await sincronizar(recursoId)).resultado;
    }

  } catch (erro) {
    resultado = `erro: ${erro.message}`.slice(0, 255);
    logger.erro('Erro ao processar webhook do Mercado Pago', { recursoId, erro: erro.message });
  }

  await db.execute(
    `INSERT INTO pagamento_eventos (provedor, tipo, recurso_id, assinatura_valida, resultado)
     VALUES ('mercadopago', ?, ?, ?, ?)`,
    [tipo || null, recursoId || null, assinaturaValida, resultado]
  );

  return { resultado, assinaturaValida };
}


/*
  Reembolso total ou parcial de um pedido pago.
  Reembolso total de pedido ainda não enviado também cancela o
  pedido e devolve o estoque.
*/
async function reembolsar(pedidoId, { valor = null, adminId = null, motivo = null } = {}) {

  const pedido = await buscarPedido(pedidoId);

  const [pagamentos] = await db.execute(
    `SELECT *
     FROM pagamentos
     WHERE pedido_id = ?
     AND provedor = 'mercadopago'
     AND tipo = 'pagamento'
     AND status IN ('aprovado', 'reembolsado_parcial')
     ORDER BY id DESC
     LIMIT 1`,
    [pedidoId]
  );

  const pagamento = pagamentos[0];

  if (!pagamento) {
    throw conflito('Não há pagamento aprovado para reembolsar neste pedido');
  }

  const disponivel = arredondar(Number(pagamento.valor) - Number(pagamento.valor_reembolsado));
  const valorReembolso = valor == null ? disponivel : arredondar(valor);

  if (valorReembolso <= 0 || valorReembolso > disponivel) {
    throw requisicaoInvalida(`O valor máximo para reembolso é ${disponivel.toFixed(2)}`);
  }

  const total = valorReembolso === disponivel;

  await mercadoPago.reembolsar(
    pagamento.provedor_id,
    total && Number(pagamento.valor_reembolsado) === 0 ? null : valorReembolso,
    `reembolso-${pedido.id}-${Number(pagamento.valor_reembolsado)}`
  );

  const novoReembolsado = arredondar(Number(pagamento.valor_reembolsado) + valorReembolso);
  const statusPagamento = total ? 'reembolsado' : 'reembolsado_parcial';

  await db.execute(
    'UPDATE pagamentos SET valor_reembolsado = ?, status = ? WHERE id = ?',
    [novoReembolsado, statusPagamento, pagamento.id]
  );

  await db.execute(
    `UPDATE pedidos
     SET valor_reembolsado = ?, reembolsado_em = NOW(), pagamento_status = ?
     WHERE id = ?`,
    [novoReembolsado, statusPagamento, pedido.id]
  );

  if (total && pedidosService.STATUS_CANCELAVEIS.includes(pedido.status)) {
    await pedidosService.cancelar(pedido.id, {
      adminId,
      origem: 'admin',
      motivo: motivo || 'Pedido cancelado com reembolso'
    });
  } else {
    await emTransacao(conexao =>
      pedidosService.registrarHistorico(conexao, {
        pedidoId: pedido.id,
        statusAnterior: pedido.status,
        statusNovo: pedido.status,
        observacao: `Reembolso de R$ ${valorReembolso.toFixed(2)}${motivo ? ` — ${motivo}` : ''}`,
        adminId,
        origem: 'admin'
      })
    );
  }

  return {
    valor_reembolsado: valorReembolso,
    total_reembolsado: novoReembolsado,
    status: statusPagamento
  };
}


/*
  Cancela pedidos cujo prazo de pagamento acabou e devolve o estoque.
  Antes, confere no Mercado Pago se o pagamento não foi aprovado.
*/
async function expirarPendentes() {

  const [pedidos] = await db.query(
    `SELECT id
     FROM pedidos
     WHERE status = 'aguardando_pagamento'
     AND pagamento_expira_em IS NOT NULL
     AND pagamento_expira_em < NOW()
     LIMIT 50`
  );

  let cancelados = 0;

  for (const { id } of pedidos) {

    try {

      const [pagamentos] = await db.execute(
        `SELECT provedor_id FROM pagamentos
         WHERE pedido_id = ? AND tipo = 'pagamento' AND provedor_id IS NOT NULL`,
        [id]
      );

      for (const pagamento of pagamentos) {
        await sincronizar(pagamento.provedor_id);
      }

      const atual = await buscarPedido(id);

      if (atual.status === 'aguardando_pagamento') {
        await pedidosService.cancelar(id, {
          origem: 'sistema',
          motivo: 'Pagamento não confirmado no prazo'
        });
        cancelados++;
      }

    } catch (erro) {
      logger.erro('Erro ao expirar pedido', { pedidoId: id, erro: erro.message });
    }
  }

  if (cancelados) {
    logger.info('Pedidos expirados cancelados', { cancelados });
  }

  return cancelados;
}


module.exports = {
  METODOS,
  iniciar,
  resumo,
  sincronizar,
  processarWebhook,
  reembolsar,
  expirarPendentes
};
