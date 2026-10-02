const PEDIDO_API_URL =
  HAZE_API_URL;


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


    renderizarHistorico(
      resultado.historico || []
    );

    pedidoAtual = resultado;

    carregarPagamentos(
      resultado
    );

    configurarRastreio(
      resultado
    );

    if (
      resultado.status === 'cancelado' &&
      resultado.motivo_cancelamento
    ) {

      pedidoCancelarMensagem.textContent =
        `Motivo: ${resultado.motivo_cancelamento}`;

    }


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
                  novoStatus,
                ...(
                  novoStatus === 'enviado'
                    ? lerCamposRastreio()
                    : {}
                )
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


      // Recarrega para mostrar histórico e datas atualizados
      await carregarPedido();


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


    const motivo =
      window.prompt(
        'Motivo do cancelamento (opcional):'
      ) || '';


    // Pedido pago no Mercado Pago: oferece devolver o dinheiro junto
    const reembolsar =
      ['aprovado', 'reembolsado_parcial'].includes(pedidoAtual?.pagamento_status) &&
      window.confirm(
        'Este pedido foi pago. Reembolsar o valor ao cliente pelo Mercado Pago?\n\nOK = cancelar e reembolsar\nCancelar = só cancelar (sem reembolso)'
      );


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

              'Content-Type':
                'application/json',

              Authorization:
                `Bearer ${token}`

            },

            body:
              JSON.stringify({
                motivo:
                  motivo.trim() || undefined,
                reembolsar
              })

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


      await carregarPedido();


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
        resultado.mensagem ||
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

/* =============================================================
   HISTÓRICO DE STATUS
============================================================= */

function renderizarHistorico(historico) {

  const lista =
    document.getElementById(
      'pedido-historico'
    );


  if (historico.length === 0) {

    lista.innerHTML =
      '<li>Sem registros.</li>';

    return;

  }


  const origens = {
    loja: 'Loja',
    admin: 'Painel',
    pagamento: 'Pagamento',
    sistema: 'Sistema'
  };


  lista.innerHTML =
    historico.map(etapa => `
      <li>
        <strong>${escaparHtml(formatarStatus(etapa.status_novo))}</strong>
        <small>
          ${escaparHtml(dataPainel(etapa.criado_em, true))}
          · ${escaparHtml(etapa.admin_nome || origens[etapa.origem] || etapa.origem)}
        </small>
        ${etapa.observacao
          ? `<small>${escaparHtml(etapa.observacao)}</small>`
          : ''}
      </li>
    `).join('');

}



/* =============================================================
   RASTREIO
============================================================= */

const pedidoRastreio =
  document.getElementById(
    'pedido-rastreio'
  );


const pedidoRastreioSalvar =
  document.getElementById(
    'pedido-rastreio-salvar'
  );


function lerCamposRastreio() {

  const valor = id =>
    document.getElementById(id).value.trim() || undefined;

  return {
    codigo_rastreio:
      valor('pedido-rastreio-codigo'),
    transportadora:
      valor('pedido-rastreio-transportadora'),
    url_rastreio:
      valor('pedido-rastreio-url')
  };

}


function configurarRastreio(pedido) {

  // Campos aparecem ao preparar o envio e ficam editáveis depois
  const mostrar = [
    'em_preparacao',
    'enviado',
    'entregue'
  ].includes(pedido.status);


  pedidoRastreio.hidden = !mostrar;


  pedidoRastreioSalvar.hidden = ![
    'enviado',
    'entregue'
  ].includes(pedido.status);


  document.getElementById('pedido-rastreio-codigo').value =
    pedido.codigo_rastreio || '';

  document.getElementById('pedido-rastreio-transportadora').value =
    pedido.transportadora || '';

  document.getElementById('pedido-rastreio-url').value =
    pedido.url_rastreio || '';

}


pedidoRastreioSalvar.addEventListener(
  'click',
  async () => {

    pedidoStatusMensagem.textContent =
      'Salvando rastreio...';

    try {

      await adminApi(
        `/admin/pedidos/${pedidoId}/rastreio`,
        {
          metodo: 'PATCH',
          corpo: lerCamposRastreio()
        }
      );

      pedidoStatusMensagem.textContent =
        'Rastreio atualizado.';

    } catch (erro) {

      pedidoStatusMensagem.textContent =
        erro.message;

    }

  }
);


/* =============================================================
   PAGAMENTO E REEMBOLSO
============================================================= */

let pedidoAtual = null;


const NOMES_PAGAMENTO = {
  pendente: 'Pendente',
  aprovado: 'Aprovado',
  em_analise: 'Em análise',
  em_disputa: 'Em disputa',
  recusado: 'Recusado',
  cancelado: 'Cancelado',
  reembolsado: 'Reembolsado',
  reembolsado_parcial: 'Reembolso parcial',
  estornado: 'Estornado (chargeback)',
  valor_divergente: 'Valor pago diferente do pedido',
  aprovado_apos_cancelamento: 'Pago após cancelamento — reembolsar'
};


async function carregarPagamentos(pedido) {

  const info =
    document.getElementById('pedido-pagamento-info');

  const metodo = {
    pix: 'PIX',
    mercadopago: 'Mercado Pago (cartão/boleto)'
  }[pedido.metodo_pagamento] || 'Não informado (pedido anterior ao checkout com pagamento)';

  const linhas = [
    `<strong>Forma:</strong> ${escaparHtml(metodo)}`,
    `<strong>Situação:</strong> ${escaparHtml(NOMES_PAGAMENTO[pedido.pagamento_status] || pedido.pagamento_status || '—')}`
  ];

  if (pedido.cupom_codigo) {
    linhas.push(`<strong>Cupom:</strong> ${escaparHtml(pedido.cupom_codigo)} (- ${formatarDinheiro(pedido.desconto)})`);
  }

  if (pedido.frete_descricao) {
    linhas.push(`<strong>Frete:</strong> ${escaparHtml(pedido.frete_descricao)} — ${Number(pedido.frete_prazo_min)} a ${Number(pedido.frete_prazo_max)} dias úteis`);
  }

  if (Number(pedido.valor_reembolsado) > 0) {
    linhas.push(`<strong>Reembolsado:</strong> ${formatarDinheiro(pedido.valor_reembolsado)} em ${escaparHtml(dataPainel(pedido.reembolsado_em, true))}`);
  }

  info.innerHTML = linhas.join('<br>');

  info.classList.toggle(
    'text-danger',
    ['valor_divergente', 'aprovado_apos_cancelamento', 'estornado'].includes(pedido.pagamento_status)
  );

  try {

    const pagamentos =
      await adminApi(`/admin/pedidos/${pedidoId}/pagamentos`);

    document.getElementById('pedido-pagamentos').innerHTML =
      pagamentos.length === 0
        ? '<tr><td colspan="6" class="admin-muted-text">Nenhum pagamento registrado.</td></tr>'
        : pagamentos.map(pagamento => `
          <tr>
            <td>${escaparHtml(pagamento.provedor_id || '—')}</td>
            <td>${escaparHtml(pagamento.tipo === 'preferencia' ? 'Link de pagamento' : (pagamento.metodo || 'Pagamento'))}</td>
            <td>${escaparHtml(NOMES_PAGAMENTO[pagamento.status] || pagamento.status)}</td>
            <td>${formatarDinheiro(pagamento.valor)}</td>
            <td>${formatarDinheiro(pagamento.valor_reembolsado)}</td>
            <td>${escaparHtml(dataPainel(pagamento.atualizado_em, true))}</td>
          </tr>`).join('');

  } catch (erro) {
    document.getElementById('pedido-pagamento-mensagem').textContent = erro.message;
  }

  const admin = lerAdminSalvo();
  const podeReembolsar =
    (!admin || admin.perfil === 'gerente') &&
    ['aprovado', 'reembolsado_parcial', 'aprovado_apos_cancelamento'].includes(pedido.pagamento_status);

  document.getElementById('pedido-reembolsar').hidden = !podeReembolsar;
  document.getElementById('pedido-reembolso-valor').hidden = !podeReembolsar;

}


document
  .getElementById('pedido-pagamento-sincronizar')
  .addEventListener('click', async evento => {

    const saida =
      document.getElementById('pedido-pagamento-mensagem');

    evento.target.disabled = true;
    saida.textContent = 'Consultando...';

    try {

      const { resultados } =
        await adminApi(`/admin/pedidos/${pedidoId}/pagamentos/sincronizar`, { metodo: 'POST' });

      saida.textContent = resultados.length
        ? `Resultado: ${resultados.map(r => r.resultado).join(', ')}`
        : 'Nenhum pagamento do Mercado Pago para consultar.';

      await carregarPedido();

    } catch (erro) {
      saida.textContent = erro.message;
    } finally {
      evento.target.disabled = false;
    }

  });


document
  .getElementById('pedido-reembolsar')
  .addEventListener('click', async evento => {

    const saida =
      document.getElementById('pedido-pagamento-mensagem');

    const valor =
      document.getElementById('pedido-reembolso-valor').value;

    const texto = valor
      ? `Reembolsar ${formatarDinheiro(valor)} deste pedido?`
      : 'Reembolsar o valor total? Se o pedido ainda não foi enviado, ele será cancelado e o estoque devolvido.';

    if (!window.confirm(texto)) {
      return;
    }

    const motivo =
      window.prompt('Motivo do reembolso (opcional):') || undefined;

    evento.target.disabled = true;

    try {

      const resultado =
        await adminApi(`/admin/pedidos/${pedidoId}/reembolso`, {
          metodo: 'POST',
          corpo: {
            valor: valor ? Number(valor) : undefined,
            motivo
          }
        });

      saida.textContent =
        `Reembolso de ${formatarDinheiro(resultado.valor_reembolsado)} realizado.`;

      document.getElementById('pedido-reembolso-valor').value = '';

      await carregarPedido();

    } catch (erro) {
      saida.textContent = erro.message;
    } finally {
      evento.target.disabled = false;
    }

  });
