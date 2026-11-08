/*
  Pagamentos via InfinitePay (Checkout Integrado).

  Fluxo:
    checkout -> pedido criado (aguardando_pagamento)
             -> iniciar(): cria o link de pagamento (PIX ou cartão)
             -> cliente paga na página da InfinitePay
             -> volta para a loja (confirmarRetorno) e/ou webhook
             -> sincronizar(): confirma na InfinitePay (payment_check)
             -> pago e valor confere -> pedido "pago"

  Nunca confiamos no que chega pela URL ou pelo webhook (os webhooks
  da InfinitePay não são assinados): o pagamento só é aceito depois
  de confirmado na API, e o link precisa ter sido criado por nós.
*/

const db = require('../config/db');
const config = require('../config/ambiente');
const infinitePay = require('../integracoes/infinitePay');
const { emTransacao } = require('../utils/transacao');
const { naoEncontrado, requisicaoInvalida, conflito } = require('../utils/erros');
const { arredondar } = require('../utils/dinheiro');
const logger = require('../utils/logger');
const pedidosService = require('./pedidosService');

// PIX e cartão são escolhidos na página da InfinitePay
const METODOS = ['infinitepay'];

/*
  Valores antigos (páginas da loja ainda em cache durante o deploy)
  e pedido sem forma de pagamento informada viram "infinitepay".
*/
function normalizarMetodo(metodo) {
  return metodo == null || ['pix', 'mercadopago', 'cartao', 'infinitepay'].includes(metodo)
    ? 'infinitepay'
    : metodo;
}

// Tempo para pagar: o link deixa de aceitar pagamento depois disso
const MINUTOS_LINK = 60;

/*
  Folga antes de cancelar o pedido: um pagamento feito no último
  minuto do link ainda tem tempo de ser confirmado.
*/
const MINUTOS_FOLGA_EXPIRACAO = 10;


function urlNotificacao() {
  // Webhook só em endereço público https
  return /^https:\/\//.test(config.urlApi)
    ? `${config.urlApi}/pagamentos/webhook/infinitepay`
    : null;
}


/*
  Identificador de cada link (order_nsu): "<pedido>-<sufixo>".
  Um pedido pode ter mais de um link (cliente gerou o pagamento de
  novo), e cada um precisa de um order_nsu próprio.
*/
function novoOrderNsu(pedidoId) {
  return `${pedidoId}-${Date.now().toString(36)}`;
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
  Cria o link de pagamento de um pedido aguardando pagamento.
  Pode ser chamada de novo (link expirou ou falhou): cada chamada gera
  um link novo, e a reserva do estoque é renovada.
*/
async function iniciar(pedidoId, metodo = 'infinitepay') {

  if (!METODOS.includes(normalizarMetodo(metodo))) {
    throw requisicaoInvalida('Forma de pagamento inválida');
  }

  const pedido = await buscarPedido(pedidoId);

  if (pedido.status !== 'aguardando_pagamento') {
    throw conflito('Este pedido não está aguardando pagamento');
  }

  const linkValidoAte = new Date(Date.now() + MINUTOS_LINK * 60 * 1000);
  const pedidoExpiraEm = new Date(linkValidoAte.getTime() + MINUTOS_FOLGA_EXPIRACAO * 60 * 1000);
  const valor = Number(pedido.total);
  const orderNsu = novoOrderNsu(pedido.id);

  const link = await infinitePay.criarLink({
    orderNsu,
    valor,
    descricao: `Pedido #${pedido.id} — Haze Drip`,
    cliente: { nome: pedido.cliente_nome, email: pedido.cliente_email },
    urlRetorno: urlRetorno(pedido),
    urlNotificacao: urlNotificacao(),
    validoAte: linkValidoAte
  });

  // tipo "link": o link criado (o pagamento em si é registrado ao ser confirmado)
  await db.execute(
    `INSERT INTO pagamentos
      (pedido_id, provedor, provedor_id, order_nsu, slug, tipo, status, valor, url, expira_em)
     VALUES (?, 'infinitepay', ?, ?, ?, 'link', 'pendente', ?, ?, ?)`,
    [pedido.id, orderNsu, orderNsu, link.slug, valor, link.url, linkValidoAte]
  );

  await db.execute(
    `UPDATE pedidos
     SET metodo_pagamento = 'infinitepay',
         pagamento_status = 'pendente',
         pagamento_url = ?,
         pagamento_expira_em = ?
     WHERE id = ?`,
    [link.url, pedidoExpiraEm, pedido.id]
  );

  return {
    metodo: 'infinitepay',
    status: 'pendente',
    url: link.url,
    expira_em: linkValidoAte
  };
}


/*
  Dados de pagamento para a tela de confirmação do pedido.
*/
async function resumo(pedidoId) {

  // Link mais recente; depois de pago, url é o comprovante da InfinitePay
  const [pagamentos] = await db.execute(
    `SELECT tipo, metodo, status, url, expira_em
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
     AND provedor = 'infinitepay'
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
     WHERE pedido_id = ? AND provedor = 'infinitepay' AND tipo = 'pagamento'
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
  Confirma um pagamento na InfinitePay e aplica o resultado ao pedido.
  Chamado pela volta do cliente, pelo webhook, pela expiração e pelo
  botão "Sincronizar" do painel.

  dados: { orderNsu, transactionNsu, slug, comprovante? }
  O order_nsu precisa ser de um link criado pela loja: é dele (no
  banco) que sai o pedido, nunca do texto que chegou.
*/
async function sincronizar({ orderNsu, transactionNsu, slug, comprovante = null }) {

  const [links] = await db.execute(
    `SELECT pedido_id FROM pagamentos
     WHERE provedor = 'infinitepay' AND tipo = 'link' AND provedor_id = ?`,
    [orderNsu]
  );

  if (links.length === 0) {
    return { resultado: 'link desconhecido' };
  }

  const verificacao = await infinitePay.verificarPagamento({ orderNsu, transactionNsu, slug });

  // Não pago ou dados que não batem: nada é gravado
  if (!verificacao.pago) {
    return { resultado: 'não pago' };
  }

  return aplicarPagamento({
    id: transactionNsu,
    pedido_id: Number(links[0].pedido_id),
    status: 'approved',
    valor: verificacao.valor,
    metodo: verificacao.metodo,
    status_detalhe: verificacao.parcelas ? `${verificacao.parcelas}x` : null,
    valor_reembolsado: 0,
    order_nsu: orderNsu,
    slug,
    comprovante
  });
}


/*
  Volta da página da InfinitePay: ela redireciona o cliente para a
  loja com order_nsu, transaction_nsu e slug na URL. Confirmar na hora
  marca o pedido como pago sem esperar o webhook.

  O link precisa ser deste pedido: dados de outro pedido não servem
  para mexer em pedidos de outras pessoas.
*/
async function confirmarRetorno(pedidoId, dados) {

  const [links] = await db.execute(
    `SELECT id FROM pagamentos
     WHERE pedido_id = ? AND provedor = 'infinitepay' AND tipo = 'link' AND provedor_id = ?`,
    [pedidoId, dados.orderNsu]
  );

  if (links.length === 0) {
    throw naoEncontrado('Pagamento não encontrado para este pedido');
  }

  return sincronizar(dados);
}


/*
  Aplica ao pedido um pagamento já confirmado na InfinitePay
  (chamado por sincronizar).
*/
async function aplicarPagamento(pagamento) {

  if (!Number.isInteger(pagamento.pedido_id) || pagamento.pedido_id <= 0) {
    return { resultado: 'pagamento sem pedido vinculado' };
  }

  const pedido = await buscarPedido(pagamento.pedido_id);
  const statusLocal = STATUS_PAGAMENTO[pagamento.status] || pagamento.status;

  // Registra/atualiza a transação (ela nasce na InfinitePay)
  const [existentes] = await db.execute(
    `SELECT id, duplicado FROM pagamentos
     WHERE provedor = 'infinitepay'
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
    // url = comprovante da InfinitePay (receipt_url), quando veio
    await db.execute(
      `INSERT INTO pagamentos
        (pedido_id, provedor, provedor_id, order_nsu, slug, tipo, metodo, status, status_detalhe, valor, valor_reembolsado, url)
       VALUES (?, 'infinitepay', ?, ?, ?, 'pagamento', ?, ?, ?, ?, ?, ?)`,
      [
        pedido.id, pagamento.id, pagamento.order_nsu || null, pagamento.slug || null,
        pagamento.metodo, statusLocal, pagamento.status_detalhe, pagamento.valor,
        pagamento.valor_reembolsado, pagamento.comprovante || null
      ]
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
          observacao: `InfinitePay #${pagamento.id} (${pagamento.metodo === 'pix' ? 'PIX' : pagamento.metodo === 'credit_card' ? `cartão${pagamento.status_detalhe ? ` ${pagamento.status_detalhe}` : ''}` : 'pagamento'})`,
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
  Confere de novo, na InfinitePay, os pagamentos já registrados de um
  pedido. Usado pelo botão "Sincronizar" do painel e pela expiração.

  A InfinitePay não tem busca de pagamentos por pedido: um pagamento
  só é conhecido pela volta do cliente ou pelo webhook (que é reenviado
  pela InfinitePay enquanto não responder 200).

  Se a consulta falhar, o erro sobe: quem chamou não deve concluir
  que o pedido não foi pago.
*/
async function sincronizarPedido(pedidoId) {

  const [registrados] = await db.execute(
    `SELECT provedor_id, order_nsu, slug FROM pagamentos
     WHERE pedido_id = ? AND provedor = 'infinitepay' AND tipo = 'pagamento'
     AND order_nsu IS NOT NULL AND slug IS NOT NULL`,
    [pedidoId]
  );

  const resultados = [];

  for (const registro of registrados) {
    const resultado = await sincronizar({
      orderNsu: registro.order_nsu,
      transactionNsu: registro.provedor_id,
      slug: registro.slug
    });
    resultados.push({ pagamento: registro.provedor_id, ...resultado });
  }

  return resultados;
}


/*
  Webhook da InfinitePay.

  O aviso não é assinado: os dados só servem para perguntar à
  InfinitePay (payment_check) se o pagamento existe e foi pago.
  Resultado:
    { resultado, tentarDeNovo } — tentarDeNovo = true quando a
    consulta falhou (a rota responde erro e a InfinitePay reenvia)
*/
async function processarWebhook(corpo = {}) {

  const texto = (valor, max) => (valor == null ? null : String(valor).trim().slice(0, max) || null);

  const orderNsu = texto(corpo.order_nsu, 80);
  const transactionNsu = texto(corpo.transaction_nsu, 80);
  const slug = texto(corpo.invoice_slug || corpo.slug, 120);
  const tipo = texto(corpo.event || corpo.type || corpo.status, 50) || 'pagamento';

  let resultado;
  let confirmado = null;
  let tentarDeNovo = false;

  try {

    if (orderNsu && transactionNsu && slug) {
      resultado = (await sincronizar({
        orderNsu,
        transactionNsu,
        slug,
        comprovante: /^https:\/\//.test(corpo.receipt_url || '') ? String(corpo.receipt_url).slice(0, 500) : null
      })).resultado;
      confirmado = !['não pago', 'link desconhecido'].includes(resultado);
    } else {
      resultado = 'dados incompletos';
    }

  } catch (erro) {
    resultado = `erro: ${erro.message}`.slice(0, 255);
    tentarDeNovo = true;
    logger.erro('Erro ao processar webhook da InfinitePay', { orderNsu, transactionNsu, erro: erro.message });
  }

  // assinatura_valida: aqui significa "confirmado na InfinitePay"
  await db.execute(
    `INSERT INTO pagamento_eventos (provedor, tipo, recurso_id, assinatura_valida, resultado)
     VALUES ('infinitepay', ?, ?, ?, ?)`,
    [tipo, transactionNsu, confirmado, resultado]
  );

  return { resultado, tentarDeNovo };
}


/*
  Registra um reembolso total ou parcial de um pedido pago.

  A InfinitePay não tem API de reembolso: o estorno é feito no app da
  InfinitePay e registrado aqui, para o pedido, o faturamento e o
  estoque ficarem certos.

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
       AND provedor = 'infinitepay'
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
  Cancela pedidos cujo prazo de pagamento acabou e devolve o estoque.
  Antes, confere de novo na InfinitePay os pagamentos registrados.
  O link deixa de aceitar pagamento antes disso (valid_until), então
  um pedido sem pagamento registrado pode ser cancelado.
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

      await sincronizarPedido(id);

      const atual = await buscarPedido(id);

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
  normalizarMetodo,
  iniciar,
  resumo,
  sincronizar,
  sincronizarPedido,
  confirmarRetorno,
  processarWebhook,
  reembolsar,
  expirarPendentes
};
