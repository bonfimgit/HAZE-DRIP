/* =============================================================
   HAZE DRIP — PÁGINA DO PEDIDO (confirmação e pagamento)
   -------------------------------------------------------------
   Acesso por ?pedido=ID&token=TOKEN (vem do checkout, da volta da
   InfinitePay ou do último pedido salvo no navegador).
   Enquanto aguarda pagamento, consulta o status a cada 5 segundos.
============================================================= */

(function () {

  const Cliente = window.HazeCliente;
  const $ = id => document.getElementById(id);

  const parametros = new URLSearchParams(window.location.search);
  const salvo = (() => {
    try {
      return JSON.parse(localStorage.getItem('hazeUltimoPedido'));
    } catch {
      return null;
    }
  })();

  const pedidoId = Number(parametros.get('pedido') || salvo?.id);
  const token = parametros.get('token') || salvo?.token;

  const NOMES_STATUS = {
    aguardando_pagamento: 'Aguardando pagamento',
    pago: 'Pagamento aprovado',
    em_preparacao: 'Em preparação',
    enviado: 'Enviado',
    entregue: 'Entregue',
    cancelado: 'Cancelado'
  };

  let consulta = null;
  let contagem = null;


  if (!Number.isInteger(pedidoId) || pedidoId <= 0 || !token) {
    window.location.href = 'index.html';
    return;
  }

  // Cliente sem login não tem "Meus pedidos"
  if (!Cliente.estaLogado()) {
    $('confirmacao-conta').href = 'conta.html#cadastrar';
    $('confirmacao-conta').textContent = 'Criar conta para acompanhar pedidos';
  }


  /* ===========================================================
     CARREGAR
  =========================================================== */

  async function carregar() {

    try {

      const pedido = await Cliente.api(
        `/pedidos/${pedidoId}/acompanhar?token=${encodeURIComponent(token)}`,
        { autenticado: false }
      );

      mostrarPedido(pedido);

      // Para de consultar quando o pagamento sai de "aguardando"
      if (pedido.status !== 'aguardando_pagamento') {
        clearInterval(consulta);
        consulta = null;
      }

    } catch (erro) {
      clearInterval(consulta);
      $('confirmacao-titulo').textContent = 'Pedido não encontrado';
      $('confirmacao-texto').textContent = erro.message;
    }
  }


  function mostrarPedido(pedido) {

    $('confirmacao-id').textContent = `#${pedido.id}`;
    $('confirmacao-status').textContent = NOMES_STATUS[pedido.status] || pedido.status;
    $('confirmacao-subtotal').textContent = formatarMoeda(pedido.subtotal);
    $('confirmacao-frete').textContent = Number(pedido.frete) === 0 ? 'Grátis' : formatarMoeda(pedido.frete);
    $('confirmacao-total').textContent = formatarMoeda(pedido.total);

    $('confirmacao-desconto-linha').hidden = !Number(pedido.desconto);
    $('confirmacao-desconto').textContent = `- ${formatarMoeda(pedido.desconto)}`;

    const aguardando = pedido.status === 'aguardando_pagamento';
    const cancelado = pedido.status === 'cancelado';

    $('confirmacao-icone').textContent = cancelado ? '✕' : (aguardando ? '…' : '✓');
    $('confirmacao-icone').classList.toggle('pendente', aguardando);
    $('confirmacao-icone').classList.toggle('cancelado', cancelado);

    $('confirmacao-eyebrow').textContent = aguardando
      ? 'AGUARDANDO PAGAMENTO'
      : (cancelado ? 'PEDIDO CANCELADO' : 'PEDIDO CONFIRMADO');

    $('confirmacao-titulo').textContent = aguardando
      ? 'Falta pouco!'
      : (cancelado ? 'Pedido cancelado' : 'Obrigado pela compra.');

    const prazo = pedido.frete_prazo_max
      ? ` Prazo de entrega: ${!pedido.frete_prazo_min || pedido.frete_prazo_min === pedido.frete_prazo_max ? '' : `${pedido.frete_prazo_min} a `}${pedido.frete_prazo_max} dias úteis após o pagamento.`
      : '';

    $('confirmacao-texto').textContent = aguardando
      ? `Seu pedido está reservado. Conclua o pagamento para confirmarmos a compra.${prazo}`
      : cancelado
        ? (pedido.motivo_cancelamento || 'Este pedido foi cancelado.')
        : `Pagamento confirmado! Enviamos os detalhes para ${pedido.cliente_email}.${prazo}`;

    mostrarPagamento(pedido);
    mostrarRastreio(pedido);

    $('confirmacao-historico').innerHTML = pedido.historico.map(etapa => `
      <li>
        <strong>${escaparHtml(NOMES_STATUS[etapa.status_novo] || etapa.status_novo)}</strong>
        <span>${escaparHtml(new Date(etapa.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }))}</span>
      </li>`).join('');
  }


  /* ===========================================================
     PAGAMENTO
  =========================================================== */

  function mostrarPagamento(pedido) {

    const bloco = $('confirmacao-pagamento');
    const pagamento = pedido.pagamento;
    const urlSegura = valor => /^https:\/\//.test(valor || '');

    // Pago: mostra só o comprovante da InfinitePay (quando houver)
    if (pedido.status !== 'aguardando_pagamento') {

      clearInterval(contagem);

      const comprovante = pagamento?.tipo === 'pagamento' && urlSegura(pagamento.url);

      bloco.hidden = !comprovante;
      $('pagamento-aberto').hidden = true;
      $('pagamento-novo').hidden = true;
      $('pagamento-comprovante').hidden = !comprovante;

      if (comprovante) {
        $('pagamento-comprovante').href = pagamento.url;
      }
      return;
    }

    bloco.hidden = false;
    $('pagamento-comprovante').hidden = true;

    const expirado = pagamento?.expira_em && new Date(pagamento.expira_em) < new Date();
    const link = pagamento?.tipo === 'link' && urlSegura(pagamento.url) && !expirado;

    $('pagamento-aberto').hidden = !link;
    $('pagamento-novo').hidden = Boolean(link);

    $('pagamento-novo-texto').textContent = expirado
      ? 'O prazo do link de pagamento acabou. Gere um novo link:'
      : 'Gere o link de pagamento para concluir o pedido:';

    if (link) {
      $('pagamento-link').href = pagamento.url;
      iniciarContagem(new Date(pagamento.expira_em));
    }
  }


  function iniciarContagem(expiraEm) {

    clearInterval(contagem);

    function atualizar() {

      const restante = expiraEm - new Date();

      if (restante <= 0) {
        clearInterval(contagem);
        $('pagamento-expira').textContent = 'Link de pagamento expirado.';
        carregar();
        return;
      }

      const minutos = Math.floor(restante / 60000);
      const segundos = Math.floor((restante % 60000) / 1000);

      $('pagamento-expira').textContent =
        `O link vale por mais ${minutos}:${String(segundos).padStart(2, '0')}.`;
    }

    atualizar();
    contagem = setInterval(atualizar, 1000);
  }


  $('pagamento-novo').addEventListener('click', async evento => {

    const botao = evento.target.closest('button[data-metodo]');
    if (!botao) return;

    const saida = $('pagamento-mensagem');
    saida.textContent = '';
    botao.disabled = true;

    try {

      const pagamento = await Cliente.api(`/pedidos/${pedidoId}/pagamento`, {
        metodo: 'POST',
        corpo: { token, metodo_pagamento: botao.dataset.metodo },
        autenticado: false
      });

      // Link novo: segue direto para a página de pagamento da InfinitePay
      if (/^https:\/\//.test(pagamento.url || '')) {
        window.location.href = pagamento.url;
        return;
      }

      await carregar();

    } catch (erro) {
      saida.textContent = erro.message;
    } finally {
      botao.disabled = false;
    }
  });


  /* ===========================================================
     RASTREIO
  =========================================================== */

  function mostrarRastreio(pedido) {

    const bloco = $('confirmacao-rastreio');

    if (!pedido.codigo_rastreio) {
      bloco.hidden = true;
      return;
    }

    bloco.hidden = false;
    bloco.innerHTML = `
      <span>Código de rastreio${pedido.transportadora ? ` (${escaparHtml(pedido.transportadora)})` : ''}:</span>
      <strong>${escaparHtml(pedido.codigo_rastreio)}</strong>
      ${pedido.url_rastreio && /^https?:\/\//i.test(pedido.url_rastreio)
        ? `<a href="${escaparHtml(pedido.url_rastreio)}" target="_blank" rel="noopener">Acompanhar entrega →</a>`
        : ''}`;
  }


  /* ===========================================================
     INÍCIO
  =========================================================== */

  /*
    Volta da InfinitePay: a URL traz order_nsu, transaction_nsu, slug
    (e receipt_url, capture_method). Pede à API para confirmar o
    pagamento agora, sem esperar o webhook. A API confere na
    InfinitePay; a URL sozinha não decide nada.
  */
  const PARAMETROS_RETORNO = ['order_nsu', 'transaction_nsu', 'slug', 'receipt_url', 'capture_method'];

  async function confirmarRetornoInfinitePay() {

    const transacao = parametros.get('transaction_nsu');

    if (!transacao) {
      return;
    }

    $('pagamento-mensagem').textContent = 'Confirmando seu pagamento...';

    try {
      await Cliente.api(`/pedidos/${pedidoId}/pagamento/confirmar`, {
        metodo: 'POST',
        corpo: {
          token,
          order_nsu: parametros.get('order_nsu'),
          transaction_nsu: transacao,
          slug: parametros.get('slug'),
          receipt_url: parametros.get('receipt_url')
        },
        autenticado: false
      });
    } catch {
      // Sem problema: o webhook e a consulta periódica confirmam depois
    }

    $('pagamento-mensagem').textContent = '';

    // Recarregar a página não repete a confirmação
    PARAMETROS_RETORNO.forEach(nome => parametros.delete(nome));
    history.replaceState(null, '', `${location.pathname}?${parametros}`);
  }


  confirmarRetornoInfinitePay().finally(() => {

    carregar();
    consulta = setInterval(carregar, 5000);

    // Não consulta para sempre se a aba ficar aberta
    setTimeout(() => clearInterval(consulta), 30 * 60 * 1000);
  });

})();
