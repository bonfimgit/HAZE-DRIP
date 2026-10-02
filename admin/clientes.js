/* =============================================================
   ADMIN — LISTA DE CLIENTES
============================================================= */

const clientesLista = document.getElementById('clientes-lista');
const clientesMensagem = document.getElementById('clientes-mensagem');
const clientesBusca = document.getElementById('clientes-busca');
const botaoAnterior = document.getElementById('clientes-anterior');
const botaoProxima = document.getElementById('clientes-proxima');

let paginaClientes = 1;


async function carregarClientes() {

  clientesMensagem.textContent = 'Carregando clientes...';

  const parametros = new URLSearchParams({ pagina: paginaClientes });
  const busca = clientesBusca.value.trim();

  if (busca) {
    parametros.set('busca', busca);
  }

  try {

    const resultado = await adminApi(`/admin/clientes?${parametros}`);

    clientesMensagem.textContent =
      `${resultado.total} cliente(s) encontrado(s).`;

    clientesLista.innerHTML = resultado.clientes.length === 0
      ? '<tr><td colspan="7" class="admin-muted-text">Nenhum cliente encontrado.</td></tr>'
      : resultado.clientes.map(cliente => `
        <tr>
          <td>
            <strong>${escaparHtmlPainel(cliente.nome)}</strong><br>
            <span class="admin-muted-text">${escaparHtmlPainel(cliente.email)}</span>
          </td>
          <td>${escaparHtmlPainel(cliente.telefone || '—')}</td>
          <td>${dataPainel(cliente.criado_em)}</td>
          <td>${Number(cliente.total_pedidos)}</td>
          <td>${moedaPainel(cliente.total_gasto)}</td>
          <td>${Number(cliente.bloqueado)
            ? '<span class="pedido-status-badge status-cancelado">Bloqueado</span>'
            : '<span class="pedido-status-badge status-pago">Ativo</span>'}</td>
          <td>
            <a href="cliente-detalhes.html?id=${Number(cliente.id)}" class="btn btn-sm btn-outline-light">Ver</a>
          </td>
        </tr>`).join('');

    botaoAnterior.disabled = paginaClientes <= 1;
    botaoProxima.disabled = paginaClientes * resultado.limite >= resultado.total;

  } catch (erro) {
    clientesMensagem.textContent = erro.message;
  }
}


document.getElementById('clientes-filtro').addEventListener('submit', evento => {
  evento.preventDefault();
  paginaClientes = 1;
  carregarClientes();
});

botaoAnterior.addEventListener('click', () => {
  paginaClientes--;
  carregarClientes();
});

botaoProxima.addEventListener('click', () => {
  paginaClientes++;
  carregarClientes();
});


carregarClientes();
