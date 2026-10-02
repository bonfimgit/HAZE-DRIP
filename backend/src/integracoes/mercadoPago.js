/*
  Cliente da API do Mercado Pago (https://www.mercadopago.com.br/developers).

  Variáveis:
    MERCADOPAGO_ACCESS_TOKEN    token da conta (TEST-... em teste, APP_USR-... em produção)
    MERCADOPAGO_WEBHOOK_SECRET  "assinatura secreta" das notificações (Suas integrações > Webhooks)

  As funções ficam num objeto exportado para que os testes possam
  substituí-las sem chamar a API real.
*/

const crypto = require('crypto');

const { ErroApp } = require('../utils/erros');

// Pode apontar para um simulador local em desenvolvimento
function base() {
  return process.env.MERCADOPAGO_API_URL || 'https://api.mercadopago.com';
}


function configurado() {
  return Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN);
}


async function requisitar(metodo, caminho, { corpo, chaveIdempotencia } = {}) {

  if (!configurado()) {
    throw new ErroApp(503, 'Pagamento indisponível no momento. Tente novamente mais tarde.');
  }

  const headers = {
    Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  };

  if (chaveIdempotencia) {
    headers['X-Idempotency-Key'] = chaveIdempotencia;
  }

  const resposta = await fetch(`${base()}${caminho}`, {
    method: metodo,
    headers,
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(15000)
  });

  const texto = await resposta.text();

  let dados = null;

  try {
    dados = JSON.parse(texto);
  } catch {
    dados = { mensagem: texto };
  }

  if (!resposta.ok) {
    const erro = new Error(
      `Mercado Pago respondeu ${resposta.status}: ${(dados.message || dados.mensagem || '').slice(0, 200)}`
    );
    erro.statusMercadoPago = resposta.status;
    throw erro;
  }

  return dados;
}


// Data no formato exigido pelo MP: 2026-10-02T17:00:00.000-03:00
function dataMercadoPago(data) {
  const brasilia = new Date(data.getTime() - 3 * 60 * 60 * 1000);
  return brasilia.toISOString().replace('Z', '-03:00');
}


const mercadoPago = {

  configurado,

  /*
    PIX direto: devolve QR Code e "copia e cola" para mostrar na loja.
  */
  async criarPix({ pedidoId, valor, descricao, email, nome, expiraEm, urlNotificacao, chaveIdempotencia }) {

    const pagamento = await requisitar('POST', '/v1/payments', {
      chaveIdempotencia,
      corpo: {
        transaction_amount: valor,
        description: descricao,
        payment_method_id: 'pix',
        external_reference: String(pedidoId),
        date_of_expiration: dataMercadoPago(expiraEm),
        ...(urlNotificacao ? { notification_url: urlNotificacao } : {}),
        payer: {
          email,
          first_name: nome
        }
      }
    });

    const transacao = pagamento.point_of_interaction?.transaction_data || {};

    return {
      id: String(pagamento.id),
      status: pagamento.status,
      status_detalhe: pagamento.status_detail ?? null,
      qr_code: transacao.qr_code || null,
      qr_code_base64: transacao.qr_code_base64 || null,
      url: transacao.ticket_url || null
    };
  },

  /*
    Checkout Pro: página do Mercado Pago com cartão, boleto e PIX.
  */
  async criarPreferencia({ pedidoId, valor, descricao, email, nome, expiraEm, urlNotificacao, urlRetorno, chaveIdempotencia }) {

    const preferencia = await requisitar('POST', '/checkout/preferences', {
      chaveIdempotencia,
      corpo: {
        items: [{
          id: String(pedidoId),
          title: descricao,
          quantity: 1,
          unit_price: valor,
          currency_id: 'BRL'
        }],
        payer: { email, name: nome },
        external_reference: String(pedidoId),
        expires: true,
        expiration_date_to: dataMercadoPago(expiraEm),
        statement_descriptor: 'HAZEDRIP',
        ...(urlNotificacao ? { notification_url: urlNotificacao } : {}),
        ...(urlRetorno
          ? {
              back_urls: { success: urlRetorno, pending: urlRetorno, failure: urlRetorno },
              auto_return: 'approved'
            }
          : {})
      }
    });

    return {
      id: String(preferencia.id),
      url: preferencia.init_point
    };
  },

  async buscarPagamento(id) {

    const pagamento = await requisitar('GET', `/v1/payments/${encodeURIComponent(id)}`);

    return {
      id: String(pagamento.id),
      status: pagamento.status,
      // Campos opcionais da API viram null (o banco não aceita undefined)
      status_detalhe: pagamento.status_detail ?? null,
      valor: Number(pagamento.transaction_amount),
      valor_reembolsado: Number(pagamento.transaction_amount_refunded || 0),
      metodo: pagamento.payment_method_id ?? null,
      tipo: pagamento.payment_type_id ?? null,
      pedido_id: Number(pagamento.external_reference)
    };
  },

  async reembolsar(id, valor, chaveIdempotencia) {

    const reembolso = await requisitar('POST', `/v1/payments/${encodeURIComponent(id)}/refunds`, {
      chaveIdempotencia,
      corpo: valor ? { amount: valor } : {}
    });

    return {
      id: String(reembolso.id),
      valor: Number(reembolso.amount),
      status: reembolso.status ?? null
    };
  },

  /*
    Valida a assinatura da notificação.
    Cabeçalho x-signature: "ts=...,v1=..."
    Manifesto: "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
  */
  validarAssinatura({ assinatura, requestId, dataId }) {

    const segredo = process.env.MERCADOPAGO_WEBHOOK_SECRET;

    if (!segredo) {
      return null; // não configurado
    }

    if (!assinatura || !dataId) {
      return false;
    }

    const partes = Object.fromEntries(
      String(assinatura).split(',').map(parte => {
        const [chave, ...valor] = parte.split('=');
        return [chave.trim(), valor.join('=').trim()];
      })
    );

    if (!partes.ts || !partes.v1) {
      return false;
    }

    const id = /^[a-z0-9]+$/i.test(dataId) ? String(dataId).toLowerCase() : dataId;

    let manifesto = `id:${id};`;
    if (requestId) manifesto += `request-id:${requestId};`;
    manifesto += `ts:${partes.ts};`;

    const esperado = crypto
      .createHmac('sha256', segredo)
      .update(manifesto)
      .digest('hex');

    const a = Buffer.from(esperado);
    const b = Buffer.from(partes.v1);

    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
};


module.exports = mercadoPago;
