/* =============================================================
   ADMIN — DETALHES DO CLIENTE
============================================================= */

const clienteId = Number(
  new URLSearchParams(window.location.search).get('id')
);

const $cliente = id => document.getElementById(id);

let clienteAtual = null;


function cartaoEstatistica(rotulo, valor) {
  return `
    <div class="col-6 col-md-4 col-lg-2">
      <div class="admin-muted-text small">${escaparHtmlPainel(rotulo)}</div>
      <strong class="fs-5">${valor}</strong>
    </div>`;
}


function preencherCliente(cliente) {

  clienteAtual = cliente;

  document.title = `${cliente.nome} — Haze Drip Admin`;

  $cliente('cliente-nome').textContent = cliente.nome;
  $cliente('cliente-email').textContent = cliente.email;
  $cliente('cliente-telefone').textContent = cliente.telefone || '—';
  $cliente('cliente-verificado').textContent = cliente.email_verificado ? 'Sim' : 'Não';
  $cliente('cliente-criado').textContent = dataPainel(cliente.criado_em, true);
  $cliente('cliente-login').textContent = dataPainel(cliente.ultimo_login_em, true);
  $cliente('cliente-motivo').textContent = cliente.bloqueado && cliente.motivo_bloqueio
    ? `Motivo do bloqueio: ${cliente.motivo_bloqueio}`
    : '';

  const status = $cliente('cliente-status');
  status.textContent = cliente.bloqueado ? 'Bloqueado' : 'Ativo';
  status.className = `pedido-status-badge ${cliente.bloqueado ? 'status-cancelado' : 'status-pago'}`;

  const botao = $cliente('cliente-bloquear');
  botao.textContent = cliente.bloqueado ? 'Desbloquear' : 'Bloquear';
  botao.className = `btn ${cliente.bloqueado ? 'btn-outline-success' : 'btn-outline-danger'}`;
  $cliente('cliente-motivo-input').hidden = cliente.bloqueado;

  const e = cliente.estatisticas;

  $cliente('cliente-estatisticas').innerHTML = [
    cartaoEstatistica('Pedidos', e.total_pedidos),
    cartaoEstatistica('Pagos', e.pedidos_pagos),
    cartaoEstatistica('Cancelados', e.pedidos_cancelados),
    cartaoEstatistica('Total gasto', moedaPainel(e.total_gasto)),
    cartaoEstatistica('Ticket médio', moedaPainel(e.ticket_medio)),
    cartaoEstatistica('Último pedido', dataPainel(e.ultimo_pedido_em))
  ].join('');

  $cliente('cliente-enderecos').innerHTML = cliente.enderecos.length === 0
    ? '<p class="admin-muted-text">Nenhum endereço cadastrado.</p>'
    : cliente.enderecos.map(endereco => `
      <p>
        <strong>${escaparHtmlPainel(endereco.apelido || 'Endereço')}</strong>
        ${Number(endereco.principal) ? '<span class="badge text-bg-secondary ms-1">Principal</span>' : ''}<br>
        ${escaparHtmlPainel(endereco.rua)}, ${escaparHtmlPainel(endereco.numero)}
        ${endereco.complemento ? `— ${escaparHtmlPainel(endereco.complemento)}` : ''}<br>
        ${escaparHtmlPainel(endereco.bairro)} — ${escaparHtmlPainel(endereco.cidade)}/${escaparHtmlPainel(endereco.estado)} — ${escaparHtmlPainel(endereco.cep)}
      </p>`).join('');

  $cliente('cliente-pedidos').innerHTML = cliente.pedidos.length === 0
    ? '<tr><td colspan="5" class="admin-muted-text">Nenhum pedido.</td></tr>'
    : cliente.pedidos.map(pedido => `
      <tr>
        <td>#${Number(pedido.id)}</td>
        <td>${dataPainel(pedido.criado_em, true)}</td>
        <td>${moedaPainel(pedido.total)}</td>
        <td>${seloStatusPedido(pedido.status)}</td>
        <td><a href="pedido-detalhes.html?id=${Number(pedido.id)}" class="btn btn-sm btn-outline-light">Ver pedido</a></td>
      </tr>`).join('');
}


async function carregarCliente() {

  if (!Number.isInteger(clienteId) || clienteId <= 0) {
    $cliente('cliente-mensagem').textContent = 'Cliente inválido.';
    return;
  }

  try {
    preencherCliente(await adminApi(`/admin/clientes/${clienteId}`));
  } catch (erro) {
    $cliente('cliente-mensagem').textContent = erro.message;
  }
}


$cliente('cliente-bloquear').addEventListener('click', async () => {

  const bloquear = !clienteAtual.bloqueado;

  const pergunta = bloquear
    ? 'Bloquear este cliente? Ele sairá da conta e não conseguirá entrar.'
    : 'Desbloquear este cliente?';

  if (!confirm(pergunta)) {
    return;
  }

  try {
    preencherCliente(await adminApi(`/admin/clientes/${clienteId}/bloqueio`, {
      metodo: 'PATCH',
      corpo: {
        bloqueado: bloquear,
        motivo: $cliente('cliente-motivo-input').value.trim() || undefined
      }
    }));
    $cliente('cliente-motivo-input').value = '';
  } catch (erro) {
    alert(erro.message);
  }
});


carregarCliente();
