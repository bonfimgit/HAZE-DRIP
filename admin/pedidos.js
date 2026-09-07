const PEDIDOS_API_URL =
  'https://hazedrip-production-6a67.up.railway.app';


const pedidosLista =
  document.getElementById(
    'pedidos-lista'
  );

  const pedidosBusca =
  document.getElementById(
    'pedidos-busca'
  );


const pedidosFiltroStatus =
  document.getElementById(
    'pedidos-filtro-status'
  );

let pedidosCarregados = [];

const pedidosMensagem =
  document.getElementById(
    'pedidos-mensagem'
  );


function pegarTokenAdmin() {

  return sessionStorage.getItem(
    'hazeAdminToken'
  );

}


/* =============================================================
   FORMATAR DINHEIRO
============================================================= */

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


/* =============================================================
   FORMATAR STATUS
============================================================= */

function formatarStatus(status) {

  const statusFormatados = {

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


  return (
    statusFormatados[status] ||
    status
  );

}

/* =============================================================
   CLASSE VISUAL DO STATUS
============================================================= */

function classeStatus(status) {

  const classes = {

    aguardando_pagamento:
      'status-aguardando',

    pago:
      'status-pago',

    em_preparacao:
      'status-preparacao',

    enviado:
      'status-enviado',

    entregue:
      'status-entregue',

    cancelado:
      'status-cancelado'

  };


  return (
    classes[status] ||
    'status-padrao'
  );

}

/* =============================================================
   RENDERIZAR PEDIDOS
============================================================= */

function renderizarPedidos(
  pedidos
) {

  pedidosLista.innerHTML = '';


  if (
    !Array.isArray(pedidos) ||
    pedidos.length === 0
  ) {

    pedidosMensagem.textContent =
      'Nenhum pedido encontrado.';

    return;

  }


  pedidosMensagem.textContent =
    `${pedidos.length} pedido(s) encontrado(s).`;


  pedidos.forEach(
    pedido => {

      const linha =
        document.createElement(
          'tr'
        );


      linha.innerHTML = `

        <td>
          #${pedido.id}
        </td>


        <td>

          <strong>
            ${pedido.cliente_nome}
          </strong>

        </td>


        <td>
          ${pedido.cliente_email}
        </td>


        <td>

          <strong>
            ${formatarDinheiro(
              pedido.total
            )}
          </strong>

        </td>


        <td>

          <span
            class="
              pedido-status-badge
              ${classeStatus(
                pedido.status
              )}
            "
          >
            ${formatarStatus(
              pedido.status
            )}
          </span>

        </td>


        <td>

          <a
            href="pedido-detalhes.html?id=${pedido.id}"
            class="btn btn-sm btn-outline-light"
          >
            Ver pedido
          </a>

        </td>

      `;


      pedidosLista.appendChild(
        linha
      );

    }
  );

}


/* =============================================================
   CARREGAR PEDIDOS
============================================================= */

async function carregarPedidos() {

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
        `${PEDIDOS_API_URL}/admin/pedidos`,
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

      sessionStorage.removeItem(
        'hazeAdmin'
      );

      window.location.href =
        'login.html';

      return;

    }


    if (!resposta.ok) {

      throw new Error(
        'Não foi possível carregar os pedidos.'
      );

    }


    const pedidos =
      await resposta.json();

    pedidosCarregados = pedidos;

 renderizarPedidos(
  pedidosCarregados
 );

 
  } catch (erro) {

    console.error(
      'Erro ao carregar pedidos:',
      erro
    );


    pedidosMensagem.textContent =
      erro.message;

  }

}

/* =============================================================
   FILTRAR PEDIDOS
============================================================= */

function filtrarPedidos() {

  const busca =
    pedidosBusca.value
      .trim()
      .toLowerCase();


  const status =
    pedidosFiltroStatus.value;


  const filtrados =
    pedidosCarregados.filter(
      pedido => {

        const correspondeStatus =
          !status ||
          pedido.status === status;


        const textoPedido =
          [
            pedido.id,
            pedido.cliente_nome,
            pedido.cliente_email
          ]
            .join(' ')
            .toLowerCase();


        const correspondeBusca =
          !busca ||
          textoPedido.includes(
            busca
          );


        return (
          correspondeStatus &&
          correspondeBusca
        );

      }
    );


  renderizarPedidos(
    filtrados
  );

}


pedidosBusca.addEventListener(
  'input',
  filtrarPedidos
);


pedidosFiltroStatus.addEventListener(
  'change',
  filtrarPedidos
);


carregarPedidos();