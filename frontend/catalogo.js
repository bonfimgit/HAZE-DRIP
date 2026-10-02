/* =============================================================
   HAZE DRIP — CATÁLOGO
   -------------------------------------------------------------
   Busca, filtros, ordenação e "carregar mais" usando a API
   (/catalogo e /catalogo/filtros). Os filtros ficam na URL
   (?busca=...&tamanho=M), então a página pode ser compartilhada
   e o botão voltar do navegador funciona.
============================================================= */

(function () {

  const $ = id => document.getElementById(id);

  const grid = $('catalogo-grid');
  const botaoMais = $('catalogo-mais');
  const contador = document.querySelector('.js-result-count');

  const POR_PAGINA = 12;

  // Estado dos filtros
  const filtros = {
    busca: '',
    categorias: new Set(),
    tamanhos: new Set(),
    cores: new Set(),
    precoMin: '',
    precoMax: '',
    promocao: false,
    disponivel: false,
    ordem: 'recentes'
  };

  let pagina = 1;
  let requisicaoAtual = 0;

  const CORES = {
    preto: '#111111',
    branco: '#f5f5f5',
    'off-white': '#e8e4dd',
    cinza: '#777777',
    vermelho: '#b91c1c',
    azul: '#1d4ed8',
    marinho: '#172554',
    verde: '#166534',
    bege: '#d6c2a1',
    marrom: '#5b3a29',
    rosa: '#f9a8d4',
    amarelo: '#facc15',
    roxo: '#6b21a8',
    laranja: '#ea580c'
  };

  function corCss(nome) {
    const chave = String(nome).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return CORES[chave] || '#777777';
  }


  /* ===========================================================
     URL <-> FILTROS
  =========================================================== */

  function lerUrl() {

    const p = new URLSearchParams(window.location.search);
    const lista = chave => (p.get(chave) || '').split(',').filter(Boolean);

    filtros.busca = p.get('busca') || '';
    filtros.categorias = new Set(lista('categoria'));
    filtros.tamanhos = new Set(lista('tamanho'));
    filtros.cores = new Set(lista('cor'));
    filtros.precoMin = p.get('preco_min') || '';
    filtros.precoMax = p.get('preco_max') || '';
    filtros.promocao = p.get('promocao') === '1';
    filtros.disponivel = p.get('disponivel') === '1';
    filtros.ordem = p.get('ordem') || 'recentes';
  }

  function parametros() {

    const p = new URLSearchParams();

    if (filtros.busca) p.set('busca', filtros.busca);
    if (filtros.categorias.size) p.set('categoria', [...filtros.categorias].join(','));
    if (filtros.tamanhos.size) p.set('tamanho', [...filtros.tamanhos].join(','));
    if (filtros.cores.size) p.set('cor', [...filtros.cores].join(','));
    if (filtros.precoMin !== '') p.set('preco_min', filtros.precoMin);
    if (filtros.precoMax !== '') p.set('preco_max', filtros.precoMax);
    if (filtros.promocao) p.set('promocao', '1');
    if (filtros.disponivel) p.set('disponivel', '1');
    if (filtros.ordem !== 'recentes') p.set('ordem', filtros.ordem);

    return p;
  }

  function salvarUrl() {
    const consulta = parametros().toString();
    history.replaceState(null, '', consulta ? `?${consulta}` : window.location.pathname);
  }


  /* ===========================================================
     PRODUTOS
  =========================================================== */

  function esqueletos(quantidade) {
    return Array.from({ length: quantidade }, () => `
      <article class="card card-esqueleto" aria-hidden="true">
        <div class="card-art"></div>
        <div class="card-info"><span></span><span></span></div>
      </article>`).join('');
  }


  async function carregarProdutos({ acrescentar = false } = {}) {

    const numero = ++requisicaoAtual;

    if (!acrescentar) {
      pagina = 1;
      grid.innerHTML = esqueletos(6);
    }

    grid.setAttribute('aria-busy', 'true');
    botaoMais.disabled = true;

    const p = parametros();
    p.set('pagina', pagina);
    p.set('limite', POR_PAGINA);

    try {

      const resposta = await fetch(`${API_URL}/catalogo?${p}`);

      if (!resposta.ok) {
        const erro = await resposta.json().catch(() => ({}));
        throw new Error(erro.mensagem || 'Não foi possível carregar os produtos.');
      }

      const dados = await resposta.json();

      // Resposta de uma busca antiga (o cliente já mudou o filtro)
      if (numero !== requisicaoAtual) {
        return;
      }

      if (!acrescentar) {
        grid.innerHTML = '';
      }

      contador.textContent = dados.total;

      if (dados.total === 0) {
        grid.innerHTML = `
          <div class="estado-vazio">
            <p>Nenhum produto encontrado com esses filtros.</p>
            <button type="button" class="btn" id="vazio-limpar">Limpar filtros</button>
          </div>`;
        $('vazio-limpar').addEventListener('click', limparFiltros);
      }

      dados.produtos.forEach(produto => grid.appendChild(criarCardProduto(produto)));

      botaoMais.hidden = dados.pagina >= dados.paginas;
      botaoMais.disabled = false;

    } catch (erro) {

      if (numero !== requisicaoAtual) return;

      grid.innerHTML = `
        <div class="estado-erro">
          <p>${escaparHtml(erro.message)}</p>
          <button type="button" class="btn" id="erro-tentar">Tentar de novo</button>
        </div>`;

      $('erro-tentar').addEventListener('click', () => carregarProdutos());
      botaoMais.hidden = true;

    } finally {
      if (numero === requisicaoAtual) {
        grid.setAttribute('aria-busy', 'false');
      }
    }
  }


  function aplicar() {
    salvarUrl();
    marcarControles();
    carregarProdutos();
  }


  botaoMais.addEventListener('click', () => {
    pagina++;
    carregarProdutos({ acrescentar: true });
  });


  /* ===========================================================
     BARRA DE FILTROS (montada com as facetas da API)
  =========================================================== */

  async function montarFiltros() {

    try {

      const resposta = await fetch(`${API_URL}/catalogo/filtros`);
      const facetas = await resposta.json();

      $('filtro-categorias').innerHTML = facetas.categorias.map(c => `
        <label class="filter-opt">
          <span><input type="checkbox" data-filtro="categorias" value="${Number(c.id)}"> ${escaparHtml(c.nome)}</span>
          <span class="count">${Number(c.total)}</span>
        </label>`).join('') || '<p class="estado-carregando">Sem categorias.</p>';

      $('filtro-tamanhos').innerHTML = facetas.tamanhos.map(t => `
        <label class="filtro-chip">
          <input type="checkbox" data-filtro="tamanhos" value="${escaparHtml(t.valor)}">
          <span>${escaparHtml(t.valor)}</span>
        </label>`).join('');

      $('filtro-cores').innerHTML = facetas.cores.map(c => `
        <label class="filtro-chip filtro-cor" title="${escaparHtml(c.valor)}">
          <input type="checkbox" data-filtro="cores" value="${escaparHtml(c.valor)}">
          <span><i style="background:${corCss(c.valor)}"></i>${escaparHtml(c.valor)}</span>
        </label>`).join('');

      if (facetas.preco.maximo) {
        $('filtro-preco-min').placeholder = `Mín. ${Math.floor(facetas.preco.minimo)}`;
        $('filtro-preco-max').placeholder = `Máx. ${Math.ceil(facetas.preco.maximo)}`;
      }

      // Abas de categoria (mobile)
      $('catalogo-abas').innerHTML =
        '<button type="button" data-aba="">Todos</button>' +
        facetas.categorias.map(c =>
          `<button type="button" data-aba="${Number(c.id)}">${escaparHtml(c.nome)}</button>`
        ).join('');

      marcarControles();

    } catch {
      $('filtro-categorias').innerHTML = '<p class="estado-carregando">Filtros indisponíveis.</p>';
    }
  }


  // Reflete o estado atual nos controles da tela
  function marcarControles() {

    document.querySelectorAll('[data-filtro]').forEach(caixa => {
      caixa.checked = filtros[caixa.dataset.filtro].has(caixa.value);
    });

    $('catalogo-busca').value = filtros.busca;
    $('filtro-preco-min').value = filtros.precoMin;
    $('filtro-preco-max').value = filtros.precoMax;
    $('filtro-promocao').checked = filtros.promocao;
    $('filtro-disponivel').checked = filtros.disponivel;
    $('catalogo-ordem').value = filtros.ordem;

    const unicaCategoria = filtros.categorias.size === 1 ? [...filtros.categorias][0] : '';

    document.querySelectorAll('[data-aba]').forEach(aba => {
      const ativa = filtros.categorias.size <= 1 && aba.dataset.aba === unicaCategoria;
      aba.classList.toggle('active', ativa);
      aba.setAttribute('aria-pressed', ativa ? 'true' : 'false');
    });
  }


  /* ===========================================================
     EVENTOS
  =========================================================== */

  document.addEventListener('change', evento => {

    const caixa = evento.target.closest('[data-filtro]');
    if (!caixa) return;

    const conjunto = filtros[caixa.dataset.filtro];

    if (caixa.checked) {
      conjunto.add(caixa.value);
    } else {
      conjunto.delete(caixa.value);
    }

    aplicar();
  });

  $('catalogo-abas').addEventListener('click', evento => {

    const aba = evento.target.closest('[data-aba]');
    if (!aba) return;

    filtros.categorias = new Set(aba.dataset.aba ? [aba.dataset.aba] : []);
    aplicar();
  });

  // Busca: ao enviar e com pausa na digitação
  let esperaBusca = null;

  $('catalogo-busca').addEventListener('input', evento => {
    clearTimeout(esperaBusca);
    esperaBusca = setTimeout(() => {
      filtros.busca = evento.target.value.trim();
      aplicar();
    }, 400);
  });

  $('catalogo-busca-form').addEventListener('submit', evento => {
    evento.preventDefault();
    clearTimeout(esperaBusca);
    filtros.busca = $('catalogo-busca').value.trim();
    aplicar();
  });

  ['filtro-preco-min', 'filtro-preco-max'].forEach(id => {
    $(id).addEventListener('change', () => {
      filtros.precoMin = $('filtro-preco-min').value;
      filtros.precoMax = $('filtro-preco-max').value;
      aplicar();
    });
  });

  $('filtro-promocao').addEventListener('change', evento => {
    filtros.promocao = evento.target.checked;
    aplicar();
  });

  $('filtro-disponivel').addEventListener('change', evento => {
    filtros.disponivel = evento.target.checked;
    aplicar();
  });

  $('catalogo-ordem').addEventListener('change', evento => {
    filtros.ordem = evento.target.value;
    aplicar();
  });


  function limparFiltros() {
    filtros.busca = '';
    filtros.categorias.clear();
    filtros.tamanhos.clear();
    filtros.cores.clear();
    filtros.precoMin = '';
    filtros.precoMax = '';
    filtros.promocao = false;
    filtros.disponivel = false;
    aplicar();
  }

  $('filtros-limpar').addEventListener('click', limparFiltros);


  // Painel de filtros no mobile
  const painel = $('catalogo-filtros');
  const abrir = document.querySelector('.js-toggle-filters');

  abrir.addEventListener('click', () => {
    painel.classList.add('open');
    abrir.setAttribute('aria-expanded', 'true');
  });

  document.querySelector('.js-close-filters').addEventListener('click', () => {
    painel.classList.remove('open');
    abrir.setAttribute('aria-expanded', 'false');
    abrir.focus();
  });

  document.addEventListener('keydown', evento => {
    if (evento.key === 'Escape' && painel.classList.contains('open')) {
      painel.classList.remove('open');
      abrir.setAttribute('aria-expanded', 'false');
    }
  });


  /* ===========================================================
     INÍCIO
  =========================================================== */

  lerUrl();
  montarFiltros();
  carregarProdutos();

})();
