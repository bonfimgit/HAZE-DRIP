/* =============================================================
   ADMIN — RELATÓRIOS (exportação CSV)
============================================================= */

const $relatorio = id => document.getElementById(id);


function dataCampo(data) {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
}

// Padrão: mês atual
const hoje = new Date();
$relatorio('relatorio-ate').value = dataCampo(hoje);
$relatorio('relatorio-de').value = dataCampo(new Date(hoje.getFullYear(), hoje.getMonth(), 1));


$relatorio('relatorio-botoes').addEventListener('click', async evento => {

  const botao = evento.target.closest('[data-tipo]');
  if (!botao) return;

  const saida = $relatorio('relatorio-mensagem');
  const parametros = new URLSearchParams();

  if ($relatorio('relatorio-de').value) parametros.set('de', $relatorio('relatorio-de').value);
  if ($relatorio('relatorio-ate').value) parametros.set('ate', $relatorio('relatorio-ate').value);

  botao.disabled = true;
  saida.textContent = 'Gerando arquivo...';

  try {

    const resposta = await fetch(
      `${HAZE_API_URL}/admin/relatorios/exportar/${botao.dataset.tipo}?${parametros}`,
      { headers: { Authorization: `Bearer ${sessionStorage.getItem(ADMIN_TOKEN_KEY)}` } }
    );

    if (resposta.status === 401) {
      sairAdmin();
      return;
    }

    if (!resposta.ok) {
      const erro = await resposta.json().catch(() => ({}));
      throw new Error(erro.mensagem || 'Não foi possível gerar o relatório.');
    }

    const arquivo = await resposta.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(arquivo);
    link.download = `haze-drip-${botao.dataset.tipo}-${dataCampo(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);

    saida.textContent = 'Arquivo baixado.';

  } catch (erro) {
    saida.textContent = erro.message;
  } finally {
    botao.disabled = false;
  }
});


const adminRelatorios = lerAdminSalvo();

if (adminRelatorios && adminRelatorios.perfil !== 'gerente') {
  window.location.href = 'dashboard.html';
}
