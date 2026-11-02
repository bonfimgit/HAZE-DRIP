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
  /*
    Checkout Pro: tempo para escolher e concluir o pagamento.
    Antes eram 3 dias para todo pedido (por causa do boleto), e um
    checkout abandonado segurava o estoque esse tempo todo. Agora só
    um boleto realmente gerado estende a reserva (ver expirarPendentes).
  */
  mercadopago: 2 * 60
};

// Depois do vencimento do boleto, prazo para a compensação bancária
const DIAS_COMPENSACAO_BOLETO = 3;

// Demais pagamentos pendentes (ex.: PIX gerado no Checkout Pro)
const MINUTOS_TOLERANCIA_PENDENTE = 15;


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


/*
  Pagou depois que o pedido foi cancelado (expirou): o valor precisa
  ser reembolsado manualmente. A marcação aparece no pedido do painel.
*/
async function marcarAprovadoAposCancelamento(pedidoId, pagamentoId) {

  await db.execute(
    "UPDATE pedidos SET pagamento_status = 'aprovado_apos_cancelamento' WHERE id = ?",
    [pedidoId]
  );

  logger.erro('Pagamento aprovado para pedido cancelado — reembolsar', {
    pedidoId,
    pagamentoId
  });

  return { resultado: 'aprovado após cancelamento' };
}


/*
  Pagamento aprovado para um pedido que já está pago.
  Se outro pagamento (não duplicado) já aprovou o pedido, este é uma
  duplicidade: fica marcado para reembolso e o pedido mostra o alerta.
  Notificação repetida do pagamento que pagou o pedido: nada a fazer.
*/
async function marcarSeDuplicado(pedidoId, pagamentoId) {

  const [outros] = await db.execute(
    `SELECT id FROM pagamentos
     WHERE pedido_id = ?
     AND provedor = 'mercadopago'
     AND tipo = 'pagamento'
     AND provedor_id <> ?
     AND duplicado = FALSE
     AND status IN ('aprovado', 'reembolsado_parcial', 'reembolsado')`,
    [pedidoId, pagamentoId]
  );

  if (outros.length === 0) {
    return { resultado: 'já processado' };
  }

  const [marcacao] = await db.execute(
    `UPDATE pagamentos SET duplicado = TRUE
     WHERE pedido_id = ? AND provedor = 'mercadopago' AND tipo = 'pagamento'
     AND provedor_id = ? AND duplicado = FALSE`,
    [pedidoId, pagamentoId]
  );

  // Já estava marcado (notificação repetida)
  if (marcacao.affectedRows === 0) {
    return { resultado: 'já processado' };
  }

  await db.execute(
    "UPDATE pedidos SET pagamento_status = 'pagamento_duplicado' WHERE id = ?",
    [pedidoId]
  );

  logger.erro('Pedido pago duas vezes — reembolsar o pagamento duplicado', {
    pedidoId,
    pagamentoId
  });

  return { resultado: 'pagamento duplicado' };
}


/*
  Sem duplicidades com saldo a reembolsar, o pedido volta a "aprovado".
*/
async function atualizarAlertaDuplicado(conexao, pedidoId) {

  const [[pendentes]] = await conexao.execute(
    `SELECT COUNT(*) AS total FROM pagamentos
     WHERE pedido_id = ? AND duplicado = TRUE
     AND status IN ('aprovado', 'reembolsado_parcial')`,
    [pedidoId]
  );

  if (Number(pendentes.total) === 0) {
    await conexao.execute(
      `UPDATE pedidos SET pagamento_status = 'aprovado'
       WHERE id = ? AND pagamento_status = 'pagamento_duplicado'`,
      [pedidoId]
    );
  }
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

  const resultado = await aplicarPagamento(pagamento);

  // Dados do Mercado Pago usados pela expiração (boleto pendente etc.)
  return {
    ...resultado,
    status_mp: pagamento.status,
    tipo_mp: pagamento.tipo,
    vencimento_mp: pagamento.vencimento
  };
}


/*
  Volta do Checkout Pro: o Mercado Pago redireciona o cliente para a
  loja com ?payment_id=... na URL. Consultar esse pagamento na hora
  confirma o pedido sem esperar o webhook (que pode atrasar ou se
  perder). O status vem sempre da API do Mercado Pago, nunca da URL.

  O pagamento precisa ser deste pedido: o ID da URL não serve para
  mexer em pedidos de outras pessoas.
*/
async function confirmarRetorno(pedidoId, pagamentoId) {

  const pagamento = await mercadoPago.buscarPagamento(pagamentoId);

  if (pagamento.pedido_id !== pedidoId) {
    throw naoEncontrado('Pagamento não encontrado para este pedido');
  }

  return aplicarPagamento(pagamento);
}


/*
  Aplica ao pedido o estado de um pagamento já consultado no
  Mercado Pago (chamado por sincronizar e confirmarRetorno).
*/
async function aplicarPagamento(pagamento) {

  if (!Number.isInteger(pagamento.pedido_id) || pagamento.pedido_id <= 0) {
    return { resultado: 'pagamento sem pedido vinculado' };
  }

  const pedido = await buscarPedido(pagamento.pedido_id);
  const statusLocal = STATUS_PAGAMENTO[pagamento.status] || pagamento.status;

  // Registra/atualiza o pagamento (no Checkout Pro ele nasce no MP)
  const [existentes] = await db.execute(
    `SELECT id, duplicado FROM pagamentos
     WHERE provedor = 'mercadopago'
     AND provedor_id = ?
     AND tipo = 'pagamento'
     AND pedido_id = ?`,
    [pagamento.id, pedido.id]
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

      try {

        /*
          Status e pagamento_status mudam juntos, na mesma transação
          e com o pedido travado. Se a expiração cancelou o pedido
          entre a leitura acima e este ponto, avancarStatus recusa.
        */
        await pedidosService.avancarStatus(pedido.id, 'pago', {
          origem: 'pagamento',
          observacao: `Mercado Pago #${pagamento.id} (${pagamento.metodo || 'pagamento'})`,
          pagamentoStatus: 'aprovado'
        });

        return { resultado: 'pedido pago' };

      } catch (erro) {

        if (erro.status !== 409) {
          throw erro;
        }

        // Relê o status atual para decidir o que aconteceu
        const atual = await buscarPedido(pedido.id);

        if (atual.status !== 'cancelado') {
          // Outro pagamento aprovou o pedido no mesmo instante
          return marcarSeDuplicado(atual.id, pagamento.id);
        }

        return marcarAprovadoAposCancelamento(atual.id, pagamento.id);
      }
    }

    if (pedido.status === 'cancelado') {
      return marcarAprovadoAposCancelamento(pedido.id, pagamento.id);
    }

    // Pedido já pago: este pode ser um segundo pagamento (pagou duas vezes)
    return marcarSeDuplicado(pedido.id, pagamento.id);
  }

  /* ---------- Reembolsado / estornado ---------- */

  if (['refunded', 'charged_back'].includes(pagamento.status)) {

    /*
      Reembolso do pagamento em duplicidade: o pedido continua pago
      pelo outro pagamento. Não cancela nem altera o faturamento.
    */
    if (existentes.length && Number(existentes[0].duplicado)) {
      await emTransacao(conexao => atualizarAlertaDuplicado(conexao, pedido.id));
      return { resultado: 'duplicidade reembolsada' };
    }

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
  Sincroniza todos os pagamentos de um pedido.

  Junta os pagamentos já registrados no banco com os encontrados no
  Mercado Pago pela referência do pedido. Assim um pagamento do
  Checkout Pro (cartão/boleto) é encontrado mesmo que o webhook
  tenha se perdido. Usado pela expiração e pelo painel.

  Se a busca no Mercado Pago falhar, o erro sobe: quem chamou não
  deve concluir que o pedido não foi pago.
*/
async function sincronizarPedido(pedidoId) {

  const [registrados] = await db.execute(
    `SELECT provedor_id FROM pagamentos
     WHERE pedido_id = ? AND tipo = 'pagamento' AND provedor_id IS NOT NULL`,
    [pedidoId]
  );

  const ids = new Set(registrados.map(pagamento => String(pagamento.provedor_id)));

  // Sem token (desenvolvimento) não há onde buscar
  if (mercadoPago.configurado()) {
    for (const id of await mercadoPago.buscarPagamentosDoPedido(pedidoId)) {
      ids.add(id);
    }
  }

  const resultados = [];

  for (const id of ids) {
    resultados.push({ pagamento: id, ...(await sincronizar(id)) });
  }

  return resultados;
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

  "cancelarPedido": usado por "cancelar e reembolsar". Recusa antes de
  devolver o dinheiro se o pedido não puder ser cancelado (já enviado),
  em vez de reembolsar e responder "cancelado" sem cancelar.

  O pagamento fica travado (FOR UPDATE) do cálculo até a gravação:
  dois cliques simultâneos não leem o mesmo saldo. O segundo espera
  o primeiro terminar e vê o valor já reembolsado.
*/
async function reembolsar(pedidoId, { valor = null, adminId = null, motivo = null, cancelarPedido = false } = {}) {

  const pedido = await buscarPedido(pedidoId);

  if (cancelarPedido && pedido.status === 'cancelado') {
    throw conflito('Pedido já está cancelado');
  }

  if (cancelarPedido && !pedidosService.STATUS_CANCELAVEIS.includes(pedido.status)) {
    throw conflito(
      'Pedido já enviado ou entregue não pode ser cancelado. ' +
      'Use "Reembolsar" para devolver o valor sem cancelar.'
    );
  }

  const resultado = await emTransacao(async conexao => {

    const [pagamentos] = await conexao.execute(
      `SELECT *
       FROM pagamentos
       WHERE pedido_id = ?
       AND provedor = 'mercadopago'
       AND tipo = 'pagamento'
       AND status IN ('aprovado', 'reembolsado_parcial')
       ORDER BY duplicado DESC, id DESC
       LIMIT 1
       FOR UPDATE`,
      [pedidoId]
    );

    // Pagamento em duplicidade é reembolsado antes do pagamento do pedido
    const pagamento = pagamentos[0];

    if (!pagamento) {
      throw conflito('Não há pagamento aprovado para reembolsar neste pedido');
    }

    const duplicado = Boolean(Number(pagamento.duplicado));

    if (duplicado && cancelarPedido) {
      throw conflito(
        'Este pedido foi pago duas vezes. Use "Reembolsar" para devolver ' +
        'primeiro o pagamento em duplicidade.'
      );
    }

    const jaReembolsado = Number(pagamento.valor_reembolsado);
    const disponivel = arredondar(Number(pagamento.valor) - jaReembolsado);
    const valorReembolso = valor == null ? disponivel : arredondar(valor);

    if (valorReembolso <= 0 || valorReembolso > disponivel) {
      throw requisicaoInvalida(`O valor máximo para reembolso é ${disponivel.toFixed(2)}`);
    }

    const total = valorReembolso === disponivel;

    /*
      Chamada externa com o pagamento travado: é uma ação rara do
      gerente, e a trava é o que impede o reembolso em dobro.
      Se o Mercado Pago recusar, nada é gravado (rollback).
    */
    await mercadoPago.reembolsar(
      pagamento.provedor_id,
      total && jaReembolsado === 0 ? null : valorReembolso,
      `reembolso-${pedido.id}-${jaReembolsado}`
    );

    const novoReembolsado = arredondar(jaReembolsado + valorReembolso);
    const statusPagamento = total ? 'reembolsado' : 'reembolsado_parcial';

    await conexao.execute(
      'UPDATE pagamentos SET valor_reembolsado = ?, status = ? WHERE id = ?',
      [novoReembolsado, statusPagamento, pagamento.id]
    );

    if (duplicado) {
      // O pedido continua pago: faturamento e status do pedido não mudam
      await atualizarAlertaDuplicado(conexao, pedido.id);
    } else {
      await conexao.execute(
        `UPDATE pedidos
         SET valor_reembolsado = ?, reembolsado_em = NOW(), pagamento_status = ?
         WHERE id = ?`,
        [novoReembolsado, statusPagamento, pedido.id]
      );
    }

    return { valorReembolso, novoReembolsado, statusPagamento, total, duplicado };
  });

  if (resultado.duplicado) {
    await emTransacao(conexao =>
      pedidosService.registrarHistorico(conexao, {
        pedidoId: pedido.id,
        statusAnterior: pedido.status,
        statusNovo: pedido.status,
        observacao: `Reembolso de pagamento em duplicidade: R$ ${resultado.valorReembolso.toFixed(2)}${motivo ? ` — ${motivo}` : ''}`,
        adminId,
        origem: 'admin'
      })
    );
  } else if (resultado.total && pedidosService.STATUS_CANCELAVEIS.includes(pedido.status)) {
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
        observacao: `Reembolso de R$ ${resultado.valorReembolso.toFixed(2)}${motivo ? ` — ${motivo}` : ''}`,
        adminId,
        origem: 'admin'
      })
    );
  }

  return {
    valor_reembolsado: resultado.valorReembolso,
    total_reembolsado: resultado.novoReembolsado,
    status: resultado.statusPagamento,
    duplicidade: resultado.duplicado
  };
}


/*
  Se o pedido tem um pagamento pendente que ainda pode ser pago,
  devolve até quando manter a reserva; senão, null.
  - Boleto: vencimento + dias de compensação bancária
  - Outros (PIX do Checkout Pro): vencimento + alguns minutos
  O prazo é calculado a partir do vencimento (fixo), então a reserva
  não se estende para sempre.
*/
function prazoDePagamentoPendente(resultados, pedido) {

  // PIX direto da loja já tem prazo próprio (30 min): só o Checkout Pro estende
  if (pedido.metodo_pagamento !== 'mercadopago') {
    return null;
  }

  const agora = Date.now();
  let maior = null;

  for (const r of resultados) {

    if (!['pending', 'in_process', 'authorized'].includes(r.status_mp)) {
      continue;
    }

    const boleto = r.tipo_mp === 'ticket';

    // Sem vencimento: só o boleto ganha prazo (contado da criação do pedido)
    if (!r.vencimento_mp && !boleto) {
      continue;
    }

    const base = r.vencimento_mp
      ? new Date(r.vencimento_mp).getTime()
      : new Date(pedido.criado_em).getTime() + DIAS_COMPENSACAO_BOLETO * 24 * 60 * 60 * 1000;

    const limite = base + (boleto
      ? DIAS_COMPENSACAO_BOLETO * 24 * 60 * 60 * 1000
      : MINUTOS_TOLERANCIA_PENDENTE * 60 * 1000);

    if (limite > agora && (!maior || limite > maior)) {
      maior = limite;
    }
  }

  return maior ? new Date(maior) : null;
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

      // Inclui pagamentos do Checkout Pro que ainda não chegaram por webhook
      const resultados = await sincronizarPedido(id);

      const atual = await buscarPedido(id);

      // Boleto ou PIX gerado e ainda dentro do prazo: mantém a reserva
      if (atual.status === 'aguardando_pagamento') {

        const novoPrazo = prazoDePagamentoPendente(resultados, atual);

        if (novoPrazo) {
          await db.execute(
            'UPDATE pedidos SET pagamento_expira_em = ? WHERE id = ?',
            [novoPrazo, id]
          );
          continue;
        }
      }

      if (atual.status === 'aguardando_pagamento') {
        /*
          "somenteSe": a conferência final é feita com o pedido travado.
          Se um webhook aprovou o pagamento depois da leitura acima,
          o cancelamento é recusado e o pedido continua pago.
        */
        await pedidosService.cancelar(id, {
          origem: 'sistema',
          motivo: 'Pagamento não confirmado no prazo',
          somenteSe: ['aguardando_pagamento']
        });
        cancelados++;
      }

    } catch (erro) {

      // Pedido mudou de status no meio do caminho: nada a cancelar
      if (erro.status === 409) {
        logger.info('Expiração ignorada: pedido mudou de status', { pedidoId: id, motivo: erro.message });
        continue;
      }

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
  sincronizarPedido,
  confirmarRetorno,
  processarWebhook,
  reembolsar,
  expirarPendentes
};
