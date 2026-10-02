/* =============================================================
   HAZE DRIP — CHECKOUT
   -------------------------------------------------------------
   1. Confere a sacola (preço/estoque atuais)
   2. Preenche dados e endereços salvos do cliente logado
   3. Cotação ao vivo: frete, cupom e total
   4. Finaliza com chave de idempotência (evita pedido duplicado)
   5. Leva ao PIX (página do pedido) ou ao Mercado Pago
============================================================= */

(function () {

  const Cliente = window.HazeCliente;
  const $ = id => document.getElementById(id);

  const CHAVE_IDEMPOTENCIA = 'hazeCheckoutChave';

  let enderecosSalvos = [];
  let cupomAplicado = '';
  let ultimaCotacao = null;
  let finalizando = false;


  /* ===========================================================
     UTILITÁRIOS
  =========================================================== */

  function gerarChave() {
    if (window.crypto?.randomUUID) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }

  // Mesma chave enquanto a aba estiver no checkout: reenvio = mesmo pedido
  function chaveIdempotencia() {
    let chave = sessionStorage.getItem(CHAVE_IDEMPOTENCIA);
    if (!chave) {
      chave = gerarChave();
      sessionStorage.setItem(CHAVE_IDEMPOTENCIA, chave);
    }
    return chave;
  }

  function itensApi() {
    return Cliente.lerCarrinho()
      .filter(item => item.disponivel !== false)
      .map(item => ({
        produto_id: Number(item.produtoId),
        variacao_id: Number(item.variacaoId),
        quantidade: Number(item.quantidade)
      }));
  }

  function enderecoSelecionado() {
    const id = $('checkout-endereco-salvo').value;
    return id ? enderecosSalvos.find(e => String(e.id) === id) : null;
  }

  function cepEUf() {
    const salvo = enderecoSelecionado();
    if (salvo) {
      return { cep: salvo.cep, estado: salvo.estado };
    }
    return {
      cep: $('checkout-cep').value.trim(),
      estado: $('checkout-estado').value.trim().toUpperCase()
    };
  }

  function mensagem(texto) {
    $('checkout-mensagem').textContent = texto || '';
  }


  /* ===========================================================
     ITENS DO RESUMO
     (chamada também pelo cliente.js depois de validar a sacola)
  =========================================================== */

  window.carregarCheckout = function () {

    const carrinho = Cliente.lerCarrinho();
    const container = $('checkout-itens');

    if (carrinho.length === 0) {
      window.location.href = 'sacola.html';
      return;
    }

    container.innerHTML = carrinho.map(item => {

      const disponivel = item.disponivel !== false;
      const subtotal = Number(item.preco) * Number(item.quantidade);

      return `
        <div class="checkout-item${disponivel ? '' : ' checkout-item-indisponivel'}">
          <img src="${escaparHtml(item.imagem || '../assets/haze-logo.png')}" alt="${escaparHtml(item.nome)}">
          <div>
            <h3>${escaparHtml(item.nome)}</h3>
            <p>${escaparHtml(item.cor)} · ${escaparHtml(item.tamanho)} · ${Number(item.quantidade)}x</p>
            ${item.aviso ? `<p class="sacola-aviso">${escaparHtml(item.aviso)}</p>` : ''}
          </div>
          <strong class="checkout-item-preco">${disponivel ? formatarMoeda(subtotal) : '—'}</strong>
        </div>`;
    }).join('');

    cotar();
  };


  /* ===========================================================
     COTAÇÃO (frete, cupom, totais)
  =========================================================== */

  let cotacaoAgendada = null;

  function agendarCotacao() {
    clearTimeout(cotacaoAgendada);
    cotacaoAgendada = setTimeout(cotar, 350);
  }

  async function cotar() {

    const itens = itensApi();

    if (itens.length === 0) {
      return;
    }

    const { cep, estado } = cepEUf();
    const cepValido = cep.replace(/\D/g, '').length === 8;

    try {

      const cotacao = await Cliente.api('/checkout/cotacao', {
        metodo: 'POST',
        corpo: {
          itens: itens.map(({ variacao_id, quantidade }) => ({ variacao_id, quantidade })),
          cep: cepValido ? cep : undefined,
          estado: cepValido && estado.length === 2 ? estado : undefined,
          cupom: cupomAplicado || undefined,
          email: $('checkout-email').value.trim() || undefined
        }
      });

      ultimaCotacao = cotacao;
      mostrarCotacao(cotacao, cepValido);

    } catch (erro) {
      mensagem(erro.message);
    }
  }

  function mostrarCotacao(cotacao, cepValido) {

    $('checkout-subtotal').textContent = formatarMoeda(cotacao.subtotal);

    // Desconto
    const linhaDesconto = $('checkout-desconto-linha');
    linhaDesconto.hidden = !cotacao.desconto;
    $('checkout-desconto').textContent = `- ${formatarMoeda(cotacao.desconto)}`;
    $('checkout-cupom-codigo').textContent = cotacao.cupom ? `(${cotacao.cupom.codigo})` : '';

    // Cupom
    const saidaCupom = $('checkout-cupom-mensagem');
    saidaCupom.classList.remove('sucesso');

    if (cupomAplicado && cotacao.erro_cupom) {
      saidaCupom.textContent = cotacao.erro_cupom;
    } else if (cotacao.cupom) {
      saidaCupom.textContent = cotacao.cupom.frete_gratis
        ? 'Cupom aplicado: frete grátis!'
        : `Cupom aplicado: ${formatarMoeda(cotacao.cupom.desconto)} de desconto.`;
      saidaCupom.classList.add('sucesso');
    } else {
      saidaCupom.textContent = '';
    }

    // Frete
    const info = $('checkout-frete-info');

    if (cotacao.frete) {

      const prazo = cotacao.frete.prazo_min_dias === cotacao.frete.prazo_max_dias
        ? `${cotacao.frete.prazo_max_dias} dias úteis`
        : `${cotacao.frete.prazo_min_dias} a ${cotacao.frete.prazo_max_dias} dias úteis`;

      $('checkout-frete').textContent = cotacao.frete.gratis ? 'Grátis' : formatarMoeda(cotacao.frete.valor);

      let texto = `${cotacao.frete.descricao}: entrega em ${prazo}.`;

      if (!cotacao.frete.gratis && cotacao.frete.gratis_acima) {
        const falta = cotacao.frete.gratis_acima - (cotacao.subtotal - cotacao.desconto);
        if (falta > 0) {
          texto += ` Faltam ${formatarMoeda(falta)} para frete grátis.`;
        }
      }

      info.textContent = texto;
      info.classList.remove('erro');

    } else {

      $('checkout-frete').textContent = cepValido ? '—' : 'Informe o CEP';
      info.textContent = cotacao.erro_frete || '';
      info.classList.toggle('erro', Boolean(cotacao.erro_frete));
    }

    $('checkout-total').textContent = formatarMoeda(cotacao.total);
  }


  /* ===========================================================
     CLIENTE LOGADO: DADOS E ENDEREÇOS
  =========================================================== */

  async function carregarCliente() {

    if (!Cliente.estaLogado()) {
      return;
    }

    $('checkout-login-aviso').hidden = true;

    try {

      const [perfil, enderecos] = await Promise.all([
        Cliente.api('/clientes/me'),
        Cliente.api('/clientes/me/enderecos')
      ]);

      $('checkout-nome').value ||= perfil.nome;
      $('checkout-email').value ||= perfil.email;
      $('checkout-telefone').value ||= perfil.telefone || '';

      enderecosSalvos = enderecos;

      if (enderecos.length) {

        const select = $('checkout-endereco-salvo');

        select.innerHTML = enderecos.map(endereco => `
          <option value="${Number(endereco.id)}">
            ${escaparHtml(endereco.apelido || 'Endereço')} — ${escaparHtml(endereco.rua)}, ${escaparHtml(endereco.numero)} (${escaparHtml(endereco.cidade)}/${escaparHtml(endereco.estado)})
          </option>`).join('') + '<option value="">Usar outro endereço</option>';

        $('checkout-enderecos-salvos').hidden = false;
        alternarEnderecoManual();
      }

      cotar();

    } catch {
      // Sessão expirada: segue como visitante
    }
  }

  function alternarEnderecoManual() {
    $('checkout-endereco-campos').hidden = Boolean(enderecoSelecionado());
  }

  $('checkout-endereco-salvo').addEventListener('change', () => {
    alternarEnderecoManual();
    cotar();
  });


  /* ===========================================================
     MÁSCARAS E CEP
  =========================================================== */

  $('checkout-cep').addEventListener('input', evento => {

    let valor = evento.target.value.replace(/\D/g, '').slice(0, 8);
    if (valor.length > 5) valor = `${valor.slice(0, 5)}-${valor.slice(5)}`;
    evento.target.value = valor;

    if (valor.length === 9) {
      buscarCep(valor.replace('-', ''));
    }
  });

  async function buscarCep(cep) {

    try {

      const resposta = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const endereco = await resposta.json();

      if (endereco.erro) {
        $('checkout-frete-info').textContent = 'CEP não encontrado. Confira o número.';
        return;
      }

      $('checkout-rua').value = endereco.logradouro || $('checkout-rua').value;
      $('checkout-bairro').value = endereco.bairro || $('checkout-bairro').value;
      $('checkout-cidade').value = endereco.localidade || $('checkout-cidade').value;
      $('checkout-estado').value = endereco.uf || $('checkout-estado').value;

      if (!$('checkout-numero').value) {
        $('checkout-numero').focus();
      }

    } catch {
      // ViaCEP fora do ar: o cliente preenche à mão
    }

    cotar();
  }

  $('checkout-estado').addEventListener('input', agendarCotacao);

  $('checkout-telefone').addEventListener('input', evento => {
    const digitos = evento.target.value.replace(/\D/g, '').slice(0, 11);
    let valor = digitos.replace(/^(\d{2})(\d)/, '($1) $2');
    valor = valor.replace(digitos.length <= 10 ? /(\d{4})(\d)/ : /(\d{5})(\d)/, '$1-$2');
    evento.target.value = valor;
  });


  /* ===========================================================
     CUPOM
  =========================================================== */

  $('checkout-cupom-form').addEventListener('submit', evento => {
    evento.preventDefault();
    cupomAplicado = $('checkout-cupom').value.trim().toUpperCase();
    $('checkout-cupom').value = cupomAplicado;
    cotar();
  });


  /* ===========================================================
     FINALIZAR
  =========================================================== */

  function validarFormulario() {

    document.querySelectorAll('.checkout-campo input').forEach(input => {
      input.classList.remove('campo-erro');
    });

    const obrigatorios = ['checkout-nome', 'checkout-email', 'checkout-telefone'];

    if (!enderecoSelecionado()) {
      obrigatorios.push('checkout-cep', 'checkout-rua', 'checkout-numero', 'checkout-bairro', 'checkout-cidade', 'checkout-estado');
    }

    let primeiroErro = null;

    function marcar(id) {
      $(id).classList.add('campo-erro');
      primeiroErro ||= $(id);
    }

    obrigatorios.forEach(id => {
      if (!$(id).value.trim()) marcar(id);
    });

    if ($('checkout-email').value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test($('checkout-email').value.trim())) {
      marcar('checkout-email');
    }

    if ($('checkout-telefone').value.trim() && $('checkout-telefone').value.replace(/\D/g, '').length < 10) {
      marcar('checkout-telefone');
    }

    if (!enderecoSelecionado()) {
      if ($('checkout-cep').value.trim() && $('checkout-cep').value.replace(/\D/g, '').length !== 8) marcar('checkout-cep');
      if ($('checkout-estado').value.trim() && !/^[A-Za-z]{2}$/.test($('checkout-estado').value.trim())) marcar('checkout-estado');
    }

    if (primeiroErro) {
      primeiroErro.focus();
      return 'Confira os campos destacados.';
    }

    if (Cliente.lerCarrinho().some(item => item.disponivel === false)) {
      return 'Há itens indisponíveis na sacola. Volte à sacola e remova-os.';
    }

    if (ultimaCotacao && !ultimaCotacao.frete) {
      return ultimaCotacao.erro_frete || 'Informe um CEP válido para calcular o frete.';
    }

    return null;
  }


  $('checkout-continuar').addEventListener('click', async () => {

    if (finalizando) {
      return;
    }

    mensagem('');

    const erro = validarFormulario();

    if (erro) {
      mensagem(erro);
      return;
    }

    const botao = $('checkout-continuar');
    const salvo = enderecoSelecionado();
    const metodo = document.querySelector('input[name="metodo_pagamento"]:checked').value;

    const corpo = {
      cliente: {
        nome: $('checkout-nome').value.trim(),
        email: $('checkout-email').value.trim().toLowerCase(),
        telefone: $('checkout-telefone').value.trim()
      },
      itens: itensApi(),
      cupom: cupomAplicado || undefined,
      metodo_pagamento: metodo,
      chave_idempotencia: chaveIdempotencia()
    };

    if (salvo) {
      corpo.endereco_id = salvo.id;
    } else {
      corpo.endereco = {
        cep: $('checkout-cep').value.trim(),
        rua: $('checkout-rua').value.trim(),
        numero: $('checkout-numero').value.trim(),
        complemento: $('checkout-complemento').value.trim(),
        bairro: $('checkout-bairro').value.trim(),
        cidade: $('checkout-cidade').value.trim(),
        estado: $('checkout-estado').value.trim().toUpperCase()
      };
    }

    finalizando = true;
    botao.disabled = true;
    botao.textContent = 'Processando...';

    try {

      const resultado = await Cliente.api('/checkout', { metodo: 'POST', corpo });

      const { pedido, pagamento } = resultado;

      localStorage.setItem('hazeUltimoPedido', JSON.stringify({
        id: pedido.id,
        token: pedido.token_acesso
      }));

      // Pedido criado: limpa a sacola e a chave usada
      localStorage.removeItem('hazeCarrinho');
      sessionStorage.removeItem(CHAVE_IDEMPOTENCIA);
      atualizarContadorCarrinho();

      // Cartão/boleto: segue para o Mercado Pago
      if (metodo === 'mercadopago' && pagamento?.url && /^https:\/\//.test(pagamento.url)) {
        window.location.href = pagamento.url;
        return;
      }

      window.location.href =
        `pedido-confirmado.html?pedido=${pedido.id}&token=${encodeURIComponent(pedido.token_acesso)}`;

    } catch (falha) {

      mensagem(falha.message);

      // Estoque mudou: atualiza a sacola para mostrar o que aconteceu
      if (falha.status === 409) {
        Cliente.validarCarrinho().then(window.carregarCheckout).catch(() => {});
      }

      finalizando = false;
      botao.disabled = false;
      botao.textContent = 'Finalizar pedido';
    }
  });


  /* ===========================================================
     INÍCIO
  =========================================================== */

  if (Cliente.lerCarrinho().length === 0) {
    window.location.href = 'sacola.html';
    return;
  }

  window.carregarCheckout();
  carregarCliente();

})();
