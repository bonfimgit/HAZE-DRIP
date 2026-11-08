/*
  Cliente do Checkout Integrado da InfinitePay.
  Documentação: https://www.infinitepay.io/checkout-documentacao

  Fluxo:
    1. criarLink(): a API cria um link de pagamento para o pedido
    2. o cliente paga (PIX ou cartão) na página da InfinitePay
    3. a InfinitePay devolve o cliente para a loja (redirect_url) com
       order_nsu, transaction_nsu e slug na URL, e avisa o webhook
    4. verificarPagamento(): confirma direto na InfinitePay
       (payment_check) antes de marcar o pedido como pago

  Os webhooks da InfinitePay NÃO são assinados: nada que chega pela
  URL ou pelo webhook é aceito sem passar por verificarPagamento().

  Não existe API de reembolso nem ambiente de testes (sandbox): o
  reembolso é feito no app da InfinitePay e registrado no painel.

  Variáveis:
    INFINITEPAY_API_KEY              chave do Checkout (começa com inchk_)
    INFINITEPAY_HANDLE               InfiniteTag, sem o "$"
    INFINITEPAY_PARCELAS_SEM_JUROS   parcelas com juros pagos pela loja
                                     (0 a 12; padrão 1 = só à vista)
    INFINITEPAY_API_URL              só para testes com simulador local

  As funções ficam num objeto exportado para que os testes possam
  substituí-las, se precisarem.
*/

const { ErroApp } = require('../utils/erros');


function base() {
  return (process.env.INFINITEPAY_API_URL || 'https://api.checkout.infinitepay.io').replace(/\/+$/, '');
}

function chave() {
  return String(process.env.INFINITEPAY_API_KEY || '').trim();
}

// InfiniteTag sem "$" e sem espaços
function handle() {
  return String(process.env.INFINITEPAY_HANDLE || '').trim().replace(/^\$/, '');
}

function configurado() {
  return Boolean(chave() && handle());
}

function parcelasSemJuros() {
  const valor = Number(process.env.INFINITEPAY_PARCELAS_SEM_JUROS ?? 1);
  return Number.isInteger(valor) && valor >= 0 && valor <= 12 ? valor : 1;
}

// R$ 129,90 -> 12990 (a InfinitePay trabalha em centavos)
function emCentavos(valor) {
  return Math.round(Number(valor) * 100);
}


async function requisitar(caminho, corpo) {

  if (!configurado()) {
    throw new ErroApp(503, 'Pagamento indisponível no momento. Tente novamente mais tarde.');
  }

  const resposta = await fetch(`${base()}${caminho}`, {
    method: 'POST',
    headers: {
      // A chave fica só no servidor; nunca vai para a loja nem para o log
      'X-Api-Key': chave(),
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(15000)
  });

  const texto = await resposta.text();

  let dados;

  try {
    dados = JSON.parse(texto);
  } catch {
    dados = { message: texto };
  }

  if (!resposta.ok) {

    const detalhe = dados.message || dados.error || dados.errors || texto;

    const dica = [401, 403].includes(resposta.status)
      ? ' (confira INFINITEPAY_API_KEY e INFINITEPAY_HANDLE: a chave e a InfiniteTag ' +
        'precisam ser da mesma conta, e o checkout integrado precisa estar habilitado)'
      : '';

    const erro = new Error(
      `InfinitePay respondeu ${resposta.status}: ${String(typeof detalhe === 'string' ? detalhe : JSON.stringify(detalhe)).slice(0, 200)}${dica}`
    );
    erro.statusInfinitePay = resposta.status;
    throw erro;
  }

  return dados;
}


const infinitePay = {

  configurado,
  emCentavos,

  /*
    Cria o link de pagamento de um pedido.

    O valor vai como um único item ("Pedido #123 — Haze Drip") com o
    total já com frete e desconto: assim o valor cobrado é sempre
    igual ao total do pedido (itens com desconto não podem ter preço
    negativo na InfinitePay).

    single_payment + valid_until: o link aceita um pagamento só e
    deixa de funcionar quando a reserva do estoque acaba.
  */
  async criarLink({ orderNsu, valor, descricao, cliente, urlRetorno, urlNotificacao, validoAte }) {

    const corpo = {
      handle: handle(),
      order_nsu: orderNsu,
      items: [{
        quantity: 1,
        price: emCentavos(valor),
        description: descricao
      }],
      ...(urlRetorno ? { redirect_url: urlRetorno } : {}),
      ...(urlNotificacao ? { webhook_url: urlNotificacao } : {}),
      ...(cliente ? { customer: { name: cliente.nome, email: cliente.email } } : {}),
      options: {
        single_payment: true,
        valid_until: validoAte.toISOString(),
        payment_methods_enabled: ['credit_card', 'pix'],
        assured_installments: parcelasSemJuros()
      }
    };

    const dados = await requisitar('/links', corpo);

    // A documentação não fixa o nome do campo: aceita os formatos conhecidos
    const url = dados.url || dados.link || dados.checkout_url || dados.data?.url || null;

    if (!url || !/^https:\/\//.test(url)) {
      throw new Error('InfinitePay não devolveu o link de pagamento');
    }

    return {
      url,
      slug: dados.slug || dados.invoice_slug || null
    };
  },

  /*
    Confirma um pagamento na InfinitePay.
    Precisa dos três identificadores (vêm da URL de retorno ou do
    webhook). Dados que não batem voltam com pago = false.
  */
  async verificarPagamento({ orderNsu, transactionNsu, slug }) {

    const dados = await requisitar('/payment_check', {
      handle: handle(),
      order_nsu: orderNsu,
      transaction_nsu: transactionNsu,
      slug
    });

    return {
      pago: dados.success === true && dados.paid === true,
      // "amount" é o valor cobrado; "paid_amount" pode ser maior
      // quando o cliente paga os juros do parcelamento
      valor: Number(dados.amount || 0) / 100,
      valorPago: Number(dados.paid_amount || dados.amount || 0) / 100,
      parcelas: Number(dados.installments) || null,
      metodo: dados.capture_method || null
    };
  }
};

module.exports = infinitePay;
