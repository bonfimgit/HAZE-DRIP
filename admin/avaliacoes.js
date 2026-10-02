/* =============================================================
   ADMIN — MODERAÇÃO DE AVALIAÇÕES
============================================================= */

async function carregarAvaliacoes() {

  const lista = document.getElementById('avaliacoes-lista');

  try {

    const avaliacoes = await adminApi('/admin/avaliacoes');

    lista.innerHTML = avaliacoes.length === 0
      ? '<tr><td colspan="7" class="admin-muted-text">Nenhuma avaliação ainda.</td></tr>'
      : avaliacoes.map(a => `
        <tr>
          <td>${dataPainel(a.criado_em)}</td>
          <td>${escaparHtmlPainel(a.produto_nome)}</td>
          <td>${escaparHtmlPainel(a.cliente_nome)}<br><span class="admin-muted-text">${escaparHtmlPainel(a.cliente_email)}</span></td>
          <td>${'★'.repeat(Number(a.nota))}</td>
          <td>${a.titulo ? `<strong>${escaparHtmlPainel(a.titulo)}</strong><br>` : ''}${escaparHtmlPainel(a.comentario || '')}</td>
          <td>${Number(a.visivel)
            ? '<span class="pedido-status-badge status-pago">Visível</span>'
            : '<span class="pedido-status-badge status-padrao">Oculta</span>'}</td>
          <td>
            <button type="button" class="btn btn-sm ${Number(a.visivel) ? 'btn-outline-danger' : 'btn-outline-success'}"
              data-avaliacao="${Number(a.id)}" data-visivel="${Number(a.visivel) ? '0' : '1'}">
              ${Number(a.visivel) ? 'Ocultar' : 'Mostrar'}
            </button>
          </td>
        </tr>`).join('');

  } catch (erro) {
    document.getElementById('avaliacoes-mensagem').textContent = erro.message;
  }
}


document.getElementById('avaliacoes-lista').addEventListener('click', async evento => {

  const botao = evento.target.closest('[data-avaliacao]');
  if (!botao) return;

  try {
    await adminApi(`/admin/avaliacoes/${Number(botao.dataset.avaliacao)}`, {
      metodo: 'PATCH',
      corpo: { visivel: botao.dataset.visivel === '1' }
    });
    await carregarAvaliacoes();
  } catch (erro) {
    alert(erro.message);
  }
});


carregarAvaliacoes();
