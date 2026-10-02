/* =============================================================
   ADMIN — ESTOQUE
============================================================= */

const $estoque = id => document.getElementById(id);

let inventario = [];
let variacaoEditando = null;
let paginaMovimentacoes = 1;

const NOMES_MOVIMENTACAO = {
  entrada: 'Entrada',
  ajuste: 'Ajuste',
  venda: 'Venda',
  cancelamento: 'Cancelamento'
};


/* ---------- Abas ---------- */

document.querySelectorAll('[data-aba]').forEach(aba => {

  aba.addEventListener('click', () => {

    document.querySelectorAll('[data-aba]').forEach(a => a.classList.toggle('active', a === aba));
    document.querySelectorAll('[data-painel]').forEach(p => {
      p.hidden = p.dataset.painel !== aba.dataset.aba;
    });

    if (aba.dataset.aba === 'movimentacoes') {
      carregarMovimentacoes();
    }
  });
});


function botaoAjustar(variacaoId) {
  return `<button type="button" class="btn btn-sm btn-outline-light" data-ajustar="${Number(variacaoId)}">Ajustar</button>`;
}


/* ---------- Estoque baixo ---------- */

async function carregarBaixo() {

  const lista = await adminApi('/admin/estoque/baixo');

  $estoque('estoque-qtd-baixo').textContent = lista.length || '';

  $estoque('estoque-baixo').innerHTML = lista.length === 0
    ? '<tr><td colspan="6" class="admin-muted-text">Nenhuma variação com estoque baixo. 👍</td></tr>'
    : lista.map(v => `
      <tr>
        <td><a href="produto-variacoes.html?id=${Number(v.produto_id)}" class="link-light">${escaparHtmlPainel(v.produto_nome)}</a></td>
        <td>${escaparHtmlPainel(v.cor)} / ${escaparHtmlPainel(v.tamanho)}</td>
        <td>${escaparHtmlPainel(v.sku)}</td>
        <td><span class="pedido-status-badge ${Number(v.estoque) === 0 ? 'status-cancelado' : 'status-aguardando'}">${Number(v.estoque)}</span></td>
        <td>${Number(v.estoque_minimo)}</td>
        <td>${botaoAjustar(v.id)}</td>
      </tr>`).join('');
}


/* ---------- Inventário ---------- */

async function carregarInventario() {
  inventario = await adminApi('/admin/estoque/inventario');
  renderizarInventario();
}

function renderizarInventario() {

  const termo = $estoque('estoque-busca').value.trim().toLowerCase();

  const linhas = inventario.filter(v =>
    !termo ||
    v.produto_nome.toLowerCase().includes(termo) ||
    String(v.sku).toLowerCase().includes(termo)
  );

  const unidades = linhas.reduce((t, v) => t + Number(v.estoque), 0);
  const valor = linhas.reduce((t, v) => t + Number(v.valor_em_estoque), 0);

  $estoque('estoque-total').textContent =
    `${linhas.length} variação(ões) · ${unidades.toLocaleString('pt-BR')} unidade(s) · ${moedaPainel(valor)} em estoque`;

  $estoque('estoque-inventario').innerHTML = linhas.map(v => {

    const baixo = Number(v.estoque) <= Math.max(Number(v.estoque_minimo), 0);
    const ativo = Number(v.produto_ativo) && Number(v.variacao_ativa);

    return `
      <tr class="${ativo ? '' : 'text-secondary'}">
        <td>${escaparHtmlPainel(v.produto_nome)}${ativo ? '' : ' <small>(inativo)</small>'}</td>
        <td>${escaparHtmlPainel(v.cor)} / ${escaparHtmlPainel(v.tamanho)}</td>
        <td>${escaparHtmlPainel(v.sku)}</td>
        <td>${baixo && ativo ? `<span class="pedido-status-badge status-aguardando">${Number(v.estoque)}</span>` : Number(v.estoque)}</td>
        <td>${Number(v.estoque_minimo)}</td>
        <td>${moedaPainel(v.valor_em_estoque)}</td>
        <td>${botaoAjustar(v.variacao_id)}</td>
      </tr>`;
  }).join('') || '<tr><td colspan="7" class="admin-muted-text">Nenhuma variação encontrada.</td></tr>';
}

$estoque('estoque-busca').addEventListener('input', renderizarInventario);


/* ---------- Movimentações ---------- */

async function carregarMovimentacoes() {

  const parametros = new URLSearchParams({ pagina: paginaMovimentacoes });

  if ($estoque('mov-tipo').value) {
    parametros.set('tipo', $estoque('mov-tipo').value);
  }

  try {

    const lista = await adminApi(`/admin/estoque/movimentacoes?${parametros}`);

    $estoque('estoque-movimentacoes').innerHTML = lista.length === 0
      ? '<tr><td colspan="7" class="admin-muted-text">Nenhuma movimentação.</td></tr>'
      : lista.map(m => `
        <tr>
          <td>${dataPainel(m.criado_em, true)}</td>
          <td>${escaparHtmlPainel(m.produto_nome)}<br><small class="admin-muted-text">${escaparHtmlPainel(m.cor)} / ${escaparHtmlPainel(m.tamanho)} · ${escaparHtmlPainel(m.sku)}</small></td>
          <td>${escaparHtmlPainel(NOMES_MOVIMENTACAO[m.tipo] || m.tipo)}</td>
          <td class="${Number(m.quantidade) < 0 ? 'text-danger' : 'text-success'}">${Number(m.quantidade) > 0 ? '+' : ''}${Number(m.quantidade)}</td>
          <td>${Number(m.estoque_anterior)} → ${Number(m.estoque_novo)}</td>
          <td>${escaparHtmlPainel(m.motivo || '')}${m.pedido_id ? ` <a href="pedido-detalhes.html?id=${Number(m.pedido_id)}" class="link-light">#${Number(m.pedido_id)}</a>` : ''}</td>
          <td>${escaparHtmlPainel(m.admin_nome || (m.pedido_id ? 'Loja' : '—'))}</td>
        </tr>`).join('');

    $estoque('mov-anterior').disabled = paginaMovimentacoes <= 1;
    $estoque('mov-proxima').disabled = lista.length < 100;

  } catch (erro) {
    $estoque('estoque-mensagem').textContent = erro.message;
  }
}

$estoque('mov-tipo').addEventListener('change', () => {
  paginaMovimentacoes = 1;
  carregarMovimentacoes();
});

$estoque('mov-anterior').addEventListener('click', () => {
  paginaMovimentacoes--;
  carregarMovimentacoes();
});

$estoque('mov-proxima').addEventListener('click', () => {
  paginaMovimentacoes++;
  carregarMovimentacoes();
});


/* ---------- Ajuste (diálogo) ---------- */

const dialogo = $estoque('estoque-dialogo');

function ajustarRotulo() {
  const entrada = $estoque('estoque-operacao').value === 'entrada';
  $estoque('estoque-quantidade-rotulo').textContent = entrada ? 'Quantidade recebida' : 'Novo estoque (contagem)';
  $estoque('estoque-quantidade').min = entrada ? 1 : 0;
}

$estoque('estoque-operacao').addEventListener('change', ajustarRotulo);


document.addEventListener('click', evento => {

  const botao = evento.target.closest('[data-ajustar]');
  if (!botao) return;

  const id = Number(botao.dataset.ajustar);
  variacaoEditando = inventario.find(v => v.variacao_id === id);

  if (!variacaoEditando) return;

  $estoque('estoque-dialogo-titulo').textContent =
    `${variacaoEditando.produto_nome} — ${variacaoEditando.cor} / ${variacaoEditando.tamanho}`;
  $estoque('estoque-dialogo-atual').textContent =
    `Estoque atual: ${variacaoEditando.estoque} · SKU ${variacaoEditando.sku}`;
  $estoque('estoque-operacao').value = 'entrada';
  $estoque('estoque-quantidade').value = '';
  $estoque('estoque-minimo').value = variacaoEditando.estoque_minimo;
  $estoque('estoque-motivo').value = '';
  $estoque('estoque-dialogo-erro').textContent = '';
  ajustarRotulo();

  dialogo.showModal();
  $estoque('estoque-quantidade').focus();
});

$estoque('estoque-cancelar').addEventListener('click', () => dialogo.close());


$estoque('estoque-form').addEventListener('submit', async evento => {

  evento.preventDefault();

  const entrada = $estoque('estoque-operacao').value === 'entrada';
  const quantidade = $estoque('estoque-quantidade').value;
  const minimo = $estoque('estoque-minimo').value;

  const corpo = {
    motivo: $estoque('estoque-motivo').value.trim() || undefined,
    estoque_minimo: minimo === '' ? undefined : Number(minimo)
  };

  if (quantidade !== '') {
    corpo[entrada ? 'entrada' : 'estoque'] = Number(quantidade);
  }

  try {

    await adminApi(
      `/produtos/${variacaoEditando.produto_id}/variacoes/${variacaoEditando.variacao_id}/estoque`,
      { metodo: 'PATCH', corpo }
    );

    dialogo.close();
    $estoque('estoque-mensagem').textContent = 'Estoque atualizado.';
    await Promise.all([carregarInventario(), carregarBaixo()]);

  } catch (erro) {
    $estoque('estoque-dialogo-erro').textContent = erro.message;
  }
});


/* ---------- Início ---------- */

Promise.all([carregarInventario(), carregarBaixo()])
  .catch(erro => {
    $estoque('estoque-mensagem').textContent = erro.message;
  });
