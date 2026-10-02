/* =============================================================
   HAZE DRIP — PÁGINA DE PRODUTO: AVALIAÇÕES E RELACIONADOS
============================================================= */

(function () {

  const $ = id => document.getElementById(id);

  const produtoId = Number(new URLSearchParams(window.location.search).get('id'));

  if (!Number.isInteger(produtoId) || produtoId <= 0) {
    return;
  }

  let paginaAvaliacoes = 1;


  function estrelas(nota) {
    const cheias = Math.round(nota);
    return `<span class="estrelas" aria-hidden="true">${'★'.repeat(cheias)}${'☆'.repeat(5 - cheias)}</span>`;
  }


  async function carregarAvaliacoes() {

    try {

      const resposta = await fetch(`${API_URL}/produtos/${produtoId}/avaliacoes?pagina=${paginaAvaliacoes}`);
      const dados = await resposta.json();

      if (paginaAvaliacoes === 1) {

        if (dados.total === 0) {
          $('avaliacoes-resumo').innerHTML =
            '<p class="estado-carregando">Este produto ainda não tem avaliações. Comprou? Avalie em Minha conta depois de receber.</p>';
          return;
        }

        const barras = [5, 4, 3, 2, 1].map(nota => {
          const quantidade = dados.distribuicao[nota] || 0;
          const largura = dados.total ? Math.round((quantidade / dados.total) * 100) : 0;
          return `
            <div class="avaliacoes-barra">
              <span>${nota} ★</span>
              <span class="avaliacoes-trilho"><span style="width:${largura}%"></span></span>
              <span>${quantidade}</span>
            </div>`;
        }).join('');

        $('avaliacoes-resumo').innerHTML = `
          <div class="avaliacoes-media">
            <strong>${Number(dados.media).toLocaleString('pt-BR')}</strong>
            ${estrelas(dados.media)}
            <span>${dados.total} avaliação(ões) de compradores</span>
          </div>
          <div class="avaliacoes-distribuicao" aria-label="Distribuição das notas">${barras}</div>`;
      }

      $('avaliacoes-lista').insertAdjacentHTML('beforeend', dados.avaliacoes.map(a => `
        <article class="avaliacao">
          <div class="avaliacao-topo">
            ${estrelas(a.nota)}
            <span class="visually-hidden">Nota ${Number(a.nota)} de 5</span>
            ${a.titulo ? `<strong>${escaparHtml(a.titulo)}</strong>` : ''}
          </div>
          ${a.comentario ? `<p>${escaparHtml(a.comentario)}</p>` : ''}
          <small>${escaparHtml(a.cliente_nome)} · ${new Date(a.criado_em).toLocaleDateString('pt-BR')} · Compra verificada</small>
        </article>`).join(''));

      const exibidas = $('avaliacoes-lista').children.length;
      $('avaliacoes-mais').hidden = exibidas >= dados.total;

    } catch {
      $('avaliacoes-resumo').innerHTML = '<p class="estado-carregando">Não foi possível carregar as avaliações.</p>';
    }
  }

  $('avaliacoes-mais').addEventListener('click', () => {
    paginaAvaliacoes++;
    carregarAvaliacoes();
  });


  async function carregarRelacionados() {

    try {

      const resposta = await fetch(`${API_URL}/produtos/${produtoId}/relacionados`);
      const produtos = await resposta.json();

      if (!Array.isArray(produtos) || produtos.length === 0) {
        return;
      }

      produtos.forEach(produto => $('relacionados-grid').appendChild(criarCardProduto(produto)));
      $('relacionados-secao').hidden = false;

    } catch {
      // Seção opcional: sem relacionados, nada é exibido
    }
  }


  carregarAvaliacoes();
  carregarRelacionados();

})();
