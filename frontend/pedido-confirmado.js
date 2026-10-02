/* =============================================================
   HAZE DRIP — PÁGINA DO PEDIDO (confirmação e pagamento)
   -------------------------------------------------------------
   Acesso por ?pedido=ID&token=TOKEN (vem do checkout, do retorno
   do Mercado Pago ou do último pedido salvo no navegador).
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
      ? ` Prazo de entrega: ${pedido.frete_prazo_min} a ${pedido.frete_prazo_max} dias úteis após o pagamento.`
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

    if (pedido.status !== 'aguardando_pagamento') {
      bloco.hidden = true;
      clearInterval(contagem);
      return;
    }

    bloco.hidden = false;

    const expirado = pagamento?.expira_em && new Date(pagamento.expira_em) < new Date();
    const pix = pagamento && pagamento.pix_qr_code && !expirado;
    const link = pagamento && pagamento.url && pagamento.tipo === 'preferencia' && !expirado;

    $('pagamento-pix').hidden = !pix;
    $('pagamento-link').hidden = !link;
    $('pagamento-novo').hidden = Boolean(pix || link);

    $('pagamento-novo-texto').textContent = expirado
      ? 'O prazo de pagamento acabou. Gere um novo pagamento:'
      : 'Escolha como pagar:';

    if (pix) {

      if (pagamento.pix_qr_code_base64) {
        $('pagamento-qr').src = `data:image/png;base64,${pagamento.pix_qr_code_base64}`;
      }

      $('pagamento-codigo').value = pagamento.pix_qr_code;
      iniciarContagem(new Date(pagamento.expira_em));
    }

    if (link && /^https:\/\//.test(pagamento.url)) {
      $('pagamento-link').href = pagamento.url;
    }
  }


  function iniciarContagem(expiraEm) {

    clearInterval(contagem);

    function atualizar() {

      const restante = expiraEm - new Date();

      if (restante <= 0) {
        clearInterval(contagem);
        $('pagamento-expira').textContent = 'Código expirado.';
        carregar();
        return;
      }

      const minutos = Math.floor(restante / 60000);
      const segundos = Math.floor((restante % 60000) / 1000);

      $('pagamento-expira').textContent =
        `O código expira em ${minutos}:${String(segundos).padStart(2, '0')}.`;
    }

    atualizar();
    contagem = setInterval(atualizar, 1000);
  }


  $('pagamento-copiar').addEventListener('click', async () => {

    const campo = $('pagamento-codigo');

    try {
      await navigator.clipboard.writeText(campo.value);
    } catch {
      campo.select();
      document.execCommand('copy');
    }

    $('pagamento-copiar').textContent = 'Copiado ✓';
    setTimeout(() => { $('pagamento-copiar').textContent = 'Copiar'; }, 2000);
  });


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

      if (botao.dataset.metodo === 'mercadopago' && /^https:\/\//.test(pagamento.url || '')) {
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

  carregar();
  consulta = setInterval(carregar, 5000);

  // Não consulta para sempre se a aba ficar aberta
  setTimeout(() => clearInterval(consulta), 30 * 60 * 1000);

})();
