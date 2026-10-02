const PEDIDO_API_URL =
  'https://hazedrip-production-6a67.up.railway.app';


const parametrosPedido =
  new URLSearchParams(
    window.location.search
  );


const pedidoId =
  Number(
    parametrosPedido.get('id')
  );


function pegarTokenAdmin() {

  return sessionStorage.getItem(
    'hazeAdminToken'
  );

}


function formatarDinheiro(valor) {

  return Number(valor)
    .toLocaleString(
      'pt-BR',
      {
        style: 'currency',
        currency: 'BRL'
      }
    );

}


function formatarStatus(status) {

  const nomes = {

    aguardando_pagamento:
      'Aguardando pagamento',

    pago:
      'Pago',

    em_preparacao:
      'Em preparação',

    enviado:
      'Enviado',

    entregue:
      'Entregue',

    cancelado:
      'Cancelado'

  };


  return nomes[status] || status;

}


/* =============================================================
   SEGURANÇA DE HTML
   Dados do pedido vêm do cliente: sempre escapar antes de
   inserir em innerHTML.
============================================================= */

function escaparHtml(valor) {

  return String(valor ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

}

async function carregarPedido() {

  const mensagem =
    document.getElementById(
      'pedido-mensagem'
    );


  if (
    !Number.isInteger(pedidoId) ||
    pedidoId <= 0
  ) {

    mensagem.textContent =
      'ID do pedido inválido.';

    return;

  }


  const token =
    pegarTokenAdmin();


  if (!token) {

    window.location.href =
      'login.html';

    return;

  }


  try {

    const resposta =
      await fetch(
        `${PEDIDO_API_URL}/admin/pedidos/${pedidoId}`,
        {
          headers: {

            Authorization:
              `Bearer ${token}`

          }
        }
      );


    if (
      resposta.status === 401 ||
      resposta.status === 403
    ) {

      sessionStorage.removeItem(
        'hazeAdminToken'
      );

      window.location.href =
        'login.html';

      return;

    }


    const resultado =
      await resposta.json();


    if (!resposta.ok) {

      throw new Error(
        resultado.mensagem ||
        'Erro ao carregar pedido.'
      );

    }


    document.getElementById(
      'pedido-titulo'
    ).textContent =
      `Pedido #${resultado.id}`;


    document.getElementById(
      'pedido-status'
    ).textContent =
      formatarStatus(
        resultado.status
      );

      configurarFluxoStatus(
  resultado.status
);


configurarCancelamento(
  resultado.status
);

    document.getElementById(
      'pedido-cliente-nome'
    ).textContent =
      resultado.cliente_nome;


    document.getElementById(
      'pedido-cliente-email'
    ).textContent =
      resultado.cliente_email;


    document.getElementById(
      'pedido-cliente-telefone'
    ).textContent =
      resultado.cliente_telefone;


    const endereco = [

      `${resultado.endereco_rua}, ${resultado.endereco_numero}`,

      resultado.endereco_complemento,

      resultado.endereco_bairro,

      `${resultado.endereco_cidade} - ${resultado.endereco_estado}`,

      `CEP: ${resultado.endereco_cep}`

    ]
      .filter(Boolean)
      .join(' | ');


    document.getElementById(
      'pedido-endereco'
    ).textContent =
      endereco;


    document.getElementById(
      'pedido-subtotal'
    ).textContent =
      formatarDinheiro(
        resultado.subtotal
      );


    document.getElementById(
      'pedido-frete'
    ).textContent =
      formatarDinheiro(
        resultado.frete
      );


    document.getElementById(
      'pedido-total'
    ).textContent =
      formatarDinheiro(
        resultado.total
      );


    const tabela =
      document.getElementById(
        'pedido-itens'
      );


    tabela.innerHTML = '';


    resultado.itens.forEach(
      item => {

        const linha =
          document.createElement(
            'tr'
          );


        linha.innerHTML = `

          <td>
            ${escaparHtml(item.produto_nome)}
          </td>

          <td>
            ${escaparHtml(item.sku || '-')}
          </td>

          <td>
            ${escaparHtml(item.cor || '-')}
          </td>

          <td>
            ${escaparHtml(item.tamanho || '-')}
          </td>

          <td>
            ${Number(item.quantidade)}
          </td>

          <td>
            ${formatarDinheiro(
              item.preco_unitario
            )}
          </td>

          <td>
            ${formatarDinheiro(
              item.subtotal
            )}
          </td>

        `;


        tabela.appendChild(
          linha
        );

      }
    );


    mensagem.textContent = '';


  } catch (erro) {

    console.error(
      'Erro ao carregar pedido:',
      erro
    );


    mensagem.textContent =
      erro.message;

  }

}

/* =============================================================
   ALTERAR STATUS DO PEDIDO
============================================================= */

const pedidoStatusSelect =
  document.getElementById(
    'pedido-status-select'
  );


const pedidoStatusSalvar =
  document.getElementById(
    'pedido-status-salvar'
  );


const pedidoStatusMensagem =
  document.getElementById(
    'pedido-status-mensagem'
  );


pedidoStatusSalvar.addEventListener(
  'click',
  async () => {

    const novoStatus =
      pedidoStatusSelect.value;


    const token =
      pegarTokenAdmin();


    pedidoStatusMensagem.textContent =
      'Atualizando...';


    pedidoStatusSalvar.disabled =
      true;


    try {

      const resposta =
        await fetch(
          `${PEDIDO_API_URL}/admin/pedidos/${pedidoId}/status`,
          {

            method:
              'PATCH',

            headers: {

              'Content-Type':
                'application/json',

              Authorization:
                `Bearer ${token}`

            },

            body:
              JSON.stringify({
                status:
                  novoStatus
              })

          }
        );


      const resultado =
        await resposta.json();


      if (!resposta.ok) {

        throw new Error(
          resultado.mensagem ||
          'Erro ao atualizar status.'
        );

      }


      document.getElementById(
        'pedido-status'
      ).textContent =
        formatarStatus(
          resultado.pedido.status
        );

        configurarFluxoStatus(
          resultado.pedido.status
        );


        configurarCancelamento(
          resultado.pedido.status
        );


      pedidoStatusMensagem.textContent =
        'Status atualizado com sucesso.';


    } catch (erro) {

      console.error(
        'Erro ao atualizar status:',
        erro
      );


      pedidoStatusMensagem.textContent =
        erro.message;

    } finally {

      pedidoStatusSalvar.disabled =
        false;

    }

  }
);

/* =============================================================
   CANCELAR PEDIDO
============================================================= */

const pedidoCancelar =
  document.getElementById(
    'pedido-cancelar'
  );


const pedidoCancelarMensagem =
  document.getElementById(
    'pedido-cancelar-mensagem'
  );


function configurarCancelamento(
  status
) {

  const statusCancelaveis = [
    'aguardando_pagamento',
    'pago',
    'em_preparacao'
  ];


  if (
    status === 'cancelado'
  ) {

    pedidoCancelar.disabled = true;

    pedidoCancelar.textContent =
      'PEDIDO CANCELADO';

    pedidoStatusSelect.disabled =
      true;

    pedidoStatusSalvar.disabled =
      true;

    return;

  }


  if (
    !statusCancelaveis.includes(
      status
    )
  ) {

    pedidoCancelar.disabled = true;

    pedidoCancelarMensagem.textContent =
      'Este pedido não pode mais ser cancelado.';

    return;

  }


  pedidoCancelar.disabled = false;

}


pedidoCancelar.addEventListener(
  'click',
  async () => {

    const confirmar =
      window.confirm(
        'Deseja realmente cancelar este pedido? O estoque dos produtos será devolvido automaticamente.'
      );


    if (!confirmar) {
      return;
    }


    const token =
      pegarTokenAdmin();


    pedidoCancelar.disabled =
      true;


    pedidoCancelar.textContent =
      'CANCELANDO...';


    pedidoCancelarMensagem.textContent =
      'Cancelando pedido...';


    try {

      const resposta =
        await fetch(
          `${PEDIDO_API_URL}/admin/pedidos/${pedidoId}/cancelar`,
          {

            method:
              'PATCH',

            headers: {

              Authorization:
                `Bearer ${token}`

            }

          }
        );


      const resultado =
        await resposta.json();


      if (!resposta.ok) {

        throw new Error(
          resultado.mensagem ||
          'Erro ao cancelar pedido.'
        );

      }


      /* ATUALIZA STATUS DA TELA */

      document.getElementById(
        'pedido-status'
      ).textContent =
        'Cancelado';


      pedidoStatusSelect.value =
        'cancelado';


      /* BLOQUEIA ALTERAÇÃO NORMAL */

      pedidoStatusSelect.disabled =
        true;


      pedidoStatusSalvar.disabled =
        true;


      /* BLOQUEIA NOVO CANCELAMENTO */

      pedidoCancelar.disabled =
        true;


      pedidoCancelar.textContent =
        'PEDIDO CANCELADO';


      pedidoCancelarMensagem.textContent =
        'Pedido cancelado e estoque devolvido com sucesso.';


    } catch (erro) {

      console.error(
        'Erro ao cancelar pedido:',
        erro
      );


      pedidoCancelarMensagem.textContent =
        erro.message;


      pedidoCancelar.disabled =
        false;


      pedidoCancelar.textContent =
        'CANCELAR PEDIDO';

    }

  }
);

/* =============================================================
   CONFIGURAR PRÓXIMO STATUS
============================================================= */

function configurarFluxoStatus(
  statusAtual
) {

  const fluxos = {

    aguardando_pagamento: {
      valor: 'pago',
      texto: 'Pago'
    },

    pago: {
      valor: 'em_preparacao',
      texto: 'Em preparação'
    },

    em_preparacao: {
      valor: 'enviado',
      texto: 'Enviado'
    },

    enviado: {
      valor: 'entregue',
      texto: 'Entregue'
    }

  };


  pedidoStatusSelect.innerHTML = '';


  const proximo =
    fluxos[statusAtual];


  /* =========================================================
     PEDIDO FINALIZADO
  ========================================================= */

  if (!proximo) {

    const option =
      document.createElement(
        'option'
      );


    option.value =
      statusAtual;


    option.textContent =
      formatarStatus(
        statusAtual
      );


    pedidoStatusSelect.appendChild(
      option
    );


    pedidoStatusSelect.disabled =
      true;


    pedidoStatusSalvar.disabled =
      true;


    return;

  }


  /* =========================================================
     PRÓXIMA ETAPA
  ========================================================= */

  const option =
    document.createElement(
      'option'
    );


  option.value =
    proximo.valor;


  option.textContent =
    proximo.texto;


  pedidoStatusSelect.appendChild(
    option
  );


  pedidoStatusSelect.disabled =
    false;


  pedidoStatusSalvar.disabled =
    false;

}

carregarPedido();