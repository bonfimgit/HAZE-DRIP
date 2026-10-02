/* =============================================================
   HAZE DRIP — SESSÃO DO CLIENTE E SACOLA
   -------------------------------------------------------------
   Carregado depois do script.js em todas as páginas da loja.

   - Guarda a sessão (token curto + refresh token)
   - Renova o token automaticamente quando expira
   - Atualiza os links de "conta" do cabeçalho
   - Sincroniza a sacola com a conta do cliente
   - Confere preço e estoque da sacola na API
============================================================= */

(function () {

  const CHAVE_SESSAO = 'hazeSessaoCliente';
  const CHAVE_CARRINHO = 'hazeCarrinho';


  /* ===========================================================
     SESSÃO
  =========================================================== */

  function lerJson(chave) {
    try {
      return JSON.parse(localStorage.getItem(chave));
    } catch {
      return null;
    }
  }

  function obterSessao() {
    return lerJson(CHAVE_SESSAO);
  }

  function salvarSessao(dados) {
    localStorage.setItem(CHAVE_SESSAO, JSON.stringify({
      token: dados.token,
      refresh_token: dados.refresh_token,
      cliente: dados.cliente
    }));
  }

  function limparSessao() {
    localStorage.removeItem(CHAVE_SESSAO);
  }

  function estaLogado() {
    return Boolean(obterSessao()?.token);
  }


  let renovacaoEmAndamento = null;

  // Evita várias renovações simultâneas
  async function renovarSessao() {

    if (!renovacaoEmAndamento) {

      renovacaoEmAndamento = (async () => {

        const sessao = obterSessao();

        if (!sessao?.refresh_token) {
          return false;
        }

        const resposta = await fetch(`${API_URL}/clientes/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: sessao.refresh_token })
        });

        if (!resposta.ok) {
          limparSessao();
          return false;
        }

        salvarSessao(await resposta.json());
        return true;

      })().finally(() => {
        renovacaoEmAndamento = null;
      });
    }

    return renovacaoEmAndamento;
  }


  /*
    fetch para a API com o token do cliente.
    Se o token expirou, renova e tenta de novo uma vez.
    Lança Error com a mensagem da API em caso de falha.
  */
  async function api(caminho, { metodo = 'GET', corpo, autenticado = true } = {}) {

    async function enviar() {

      const headers = {};

      if (corpo !== undefined) {
        headers['Content-Type'] = 'application/json';
      }

      const sessao = obterSessao();

      if (autenticado && sessao?.token) {
        headers.Authorization = `Bearer ${sessao.token}`;
      }

      return fetch(`${API_URL}${caminho}`, {
        method: metodo,
        headers,
        body: corpo !== undefined ? JSON.stringify(corpo) : undefined
      });
    }

    let resposta = await enviar();

    if (resposta.status === 401 && autenticado && obterSessao()?.refresh_token) {
      if (await renovarSessao()) {
        resposta = await enviar();
      }
    }

    let dados = null;

    try {
      dados = await resposta.json();
    } catch {
      dados = null;
    }

    if (!resposta.ok) {

      if (resposta.status === 401 && autenticado) {
        limparSessao();
      }

      const erro = new Error(
        dados?.mensagem || dados?.erro || 'Não foi possível concluir a operação.'
      );
      erro.status = resposta.status;
      throw erro;
    }

    return dados;
  }


  async function sair() {

    const sessao = obterSessao();

    try {
      if (sessao?.refresh_token) {
        await api('/clientes/logout', {
          metodo: 'POST',
          corpo: { refresh_token: sessao.refresh_token },
          autenticado: false
        });
      }
    } catch {}

    limparSessao();

    // Computador compartilhado: não deixa a sacola da conta para o próximo
    localStorage.removeItem(CHAVE_CARRINHO);

    window.location.href = 'index.html';
  }


  /*
    Exige login: redireciona para conta.html e volta depois.
  */
  function exigirLogin() {

    if (estaLogado()) {
      return true;
    }

    const voltar = encodeURIComponent(
      window.location.pathname.split('/').pop() + window.location.search + window.location.hash
    );

    window.location.href = `conta.html?voltar=${voltar}`;
    return false;
  }


  /* ===========================================================
     LINKS DO CABEÇALHO
  =========================================================== */

  function atualizarLinksConta() {

    const destino = estaLogado() ? 'minha-conta.html' : 'conta.html';
    const rotulo = estaLogado() ? 'Minha conta' : 'Entrar';

    document
      .querySelectorAll('.nav-icon-btn.account')
      .forEach(link => {
        link.href = destino;
        link.setAttribute('aria-label', rotulo);
        link.title = rotulo;
      });

    // Barra inferior mobile: links "Perfil" e "Carrinho"
    document
      .querySelectorAll('.bottom-nav a')
      .forEach(link => {

        const texto = link.textContent.trim().toLowerCase();

        if (texto.endsWith('perfil')) {
          link.href = destino;
        }

        if (texto.endsWith('carrinho')) {
          link.href = 'sacola.html';
        }
      });
  }


  /* ===========================================================
     SACOLA
  =========================================================== */

  function lerCarrinho() {
    return lerJson(CHAVE_CARRINHO) || [];
  }

  function gravarCarrinho(itens) {
    localStorage.setItem(CHAVE_CARRINHO, JSON.stringify(itens));
  }

  // Formato da API -> formato salvo no navegador
  function paraItemLocal(item, anterior = {}) {
    return {
      produtoId: item.produto_id ?? anterior.produtoId,
      variacaoId: item.variacao_id,
      nome: item.nome ?? anterior.nome,
      preco: item.preco ?? anterior.preco,
      cor: item.cor ?? anterior.cor,
      tamanho: item.tamanho ?? anterior.tamanho,
      quantidade: item.quantidade,
      imagem: item.imagem || anterior.imagem || '',
      estoque: item.estoque ?? anterior.estoque ?? 0,
      disponivel: item.disponivel !== false,
      aviso: item.aviso || null
    };
  }

  function paraItemApi(item) {
    return {
      variacao_id: Number(item.variacaoId),
      quantidade: Number(item.quantidade)
    };
  }


  const CHAVE_PENDENTE = 'hazeCarrinhoPendente';

  async function enviarCarrinho() {

    localStorage.setItem(CHAVE_PENDENTE, '1');

    await api('/clientes/me/carrinho', {
      metodo: 'PUT',
      corpo: { itens: lerCarrinho().map(paraItemApi) }
    });

    localStorage.removeItem(CHAVE_PENDENTE);
  }

  // Chamado pelo script.js sempre que a sacola muda
  function carrinhoAlterado() {

    if (!estaLogado()) {
      return;
    }

    enviarCarrinho().catch(() => {});
  }


  /*
    Junta a sacola do visitante com a da conta (usado no login).
  */
  async function mesclarCarrinhoNoLogin() {

    const local = lerCarrinho();

    const resultado = await api('/clientes/me/carrinho', {
      metodo: 'PUT',
      corpo: { itens: local.map(paraItemApi), mesclar: true }
    });

    aplicarResultado(resultado, local);
  }


  async function baixarCarrinhoDaConta() {

    const local = lerCarrinho();
    const resultado = await api('/clientes/me/carrinho');

    aplicarResultado(resultado, local);
  }


  function aplicarResultado(resultado, local) {

    const anteriores = new Map(
      local.map(item => [Number(item.variacaoId), item])
    );

    gravarCarrinho(
      resultado.itens.map(item =>
        paraItemLocal(item, anteriores.get(item.variacao_id))
      )
    );

    if (typeof atualizarContadorCarrinho === 'function') {
      atualizarContadorCarrinho();
    }
  }


  /*
    Confere a sacola na API: atualiza preços e estoque e marca
    itens indisponíveis. Devolve o resultado da validação.
  */
  async function validarCarrinho() {

    const local = lerCarrinho();

    if (local.length === 0) {
      return { itens: [], valido: true, subtotal: 0 };
    }

    const resultado = await api('/carrinho/validar', {
      metodo: 'POST',
      corpo: { itens: local.map(paraItemApi) },
      autenticado: false
    });

    aplicarResultado(resultado, local);

    return resultado;
  }


  /* ===========================================================
     INICIALIZAÇÃO
  =========================================================== */

  window.HazeCliente = {
    api,
    obterSessao,
    salvarSessao,
    limparSessao,
    estaLogado,
    exigirLogin,
    sair,
    lerCarrinho,
    carrinhoAlterado,
    mesclarCarrinhoNoLogin,
    validarCarrinho,
    atualizarLinksConta
  };

  atualizarLinksConta();

  /*
    Recupera a sacola salva na conta (outro dispositivo, outra sessão).
    Se a última alteração local ainda não chegou ao servidor
    (ex.: trocou de página no meio do envio), envia em vez de baixar.
  */
  if (estaLogado() && !document.body.dataset.semSincronizarCarrinho) {

    const sincronizar = localStorage.getItem(CHAVE_PENDENTE)
      ? enviarCarrinho()
      : baixarCarrinhoDaConta();

    sincronizar
      .catch(() => {})
      .finally(revalidarSacolaNaPagina);

  } else {

    revalidarSacolaNaPagina();
  }


  /*
    Na sacola e no checkout, confere preço e estoque atuais
    e redesenha a lista com os avisos.
  */
  function revalidarSacolaNaPagina() {

    const naSacola = document.getElementById('sacola-itens');
    const noCheckout = document.getElementById('checkout-itens');

    if (!naSacola && !noCheckout) {
      return;
    }

    validarCarrinho()
      .catch(() => {})
      .finally(() => {
        if (naSacola && typeof carregarSacola === 'function') {
          carregarSacola();
        }
        if (noCheckout && typeof carregarCheckout === 'function') {
          carregarCheckout();
        }
      });
  }

})();
