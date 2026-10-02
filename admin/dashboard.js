/* =============================================================
   ADMIN — DASHBOARD
   -------------------------------------------------------------
   Indicadores do período, pendências da operação, gráfico de
   faturamento por dia (SVG, sem biblioteca) e mais vendidos.
============================================================= */

const $dash = id => document.getElementById(id);

// Cor da série validada contra a superfície escura do painel (#111)
const COR_SERIE = '#3987e5';

let diasPeriodo = 30;


function dataIso(data) {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
}

function rotuloDia(iso, comAno = false) {
  const [ano, mes, dia] = iso.split('-');
  return comAno ? `${dia}/${mes}/${ano}` : `${dia}/${mes}`;
}

function moedaCurta(valor) {
  if (valor >= 1000) {
    return `R$ ${(valor / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  }
  return `R$ ${Math.round(valor).toLocaleString('pt-BR')}`;
}

function percentual(valor) {
  return `${Number(valor).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}


/* =============================================================
   CARREGAR
============================================================= */

async function carregarDashboard() {

  const ate = new Date();
  const de = new Date(ate.getTime() - (diasPeriodo - 1) * 86400000);

  $dash('dash-mensagem').textContent = 'Carregando indicadores...';
  $dash('dash-mensagem').hidden = false;

  try {

    const dados = await adminApi(
      `/admin/relatorios/dashboard?de=${dataIso(de)}&ate=${dataIso(ate)}`
    );

    $dash('dash-periodo-texto').textContent =
      `${rotuloDia(dados.periodo.de, true)} a ${rotuloDia(dados.periodo.ate, true)}`;

    renderizarPendencias(dados.operacao);
    renderizarKpis(dados);
    renderizarGrafico(dados.vendas_por_dia);
    renderizarRanking('dash-produtos', dados.mais_vendidos, 'produto_nome');
    renderizarRanking('dash-categorias', dados.categorias, 'categoria');

    $dash('dash-mensagem').hidden = true;

  } catch (erro) {
    $dash('dash-mensagem').textContent = erro.message;
  }
}


/* =============================================================
   PENDÊNCIAS (links para onde agir)
============================================================= */

function renderizarPendencias(operacao) {

  const itens = [
    { valor: operacao.para_enviar, rotulo: 'Pedidos para preparar/enviar', link: 'pedidos.html?status=pago' },
    { valor: operacao.aguardando_pagamento, rotulo: 'Aguardando pagamento', link: 'pedidos.html?status=aguardando_pagamento' },
    { valor: operacao.estoque_baixo, rotulo: 'Variações com estoque baixo', link: 'estoque.html', alerta: operacao.estoque_baixo > 0 },
    { valor: operacao.pagamentos_com_problema, rotulo: 'Pagamentos para revisar', link: 'pedidos.html', alerta: operacao.pagamentos_com_problema > 0, ocultarZero: true },
    { valor: operacao.produtos_ativos, rotulo: `Produtos ativos (${operacao.produtos_destaque} em destaque)`, link: 'produtos.html' }
  ].filter(item => !(item.ocultarZero && item.valor === 0));

  $dash('dash-pendencias').innerHTML = itens.map(item => `
    <a href="${item.link}" class="dash-pendencia${item.alerta ? ' alerta' : ''}">
      <strong>${Number(item.valor)}</strong>
      <span>${item.alerta ? '⚠ ' : ''}${escaparHtmlPainel(item.rotulo)}</span>
    </a>`).join('');
}


/* =============================================================
   INDICADORES
============================================================= */

function renderizarKpis({ vendas, clientes }) {

  const kpis = [
    {
      rotulo: 'Faturamento líquido',
      valor: moedaPainel(vendas.faturamento),
      detalhe: vendas.reembolsado > 0
        ? `${moedaPainel(vendas.faturamento_bruto)} bruto − ${moedaPainel(vendas.reembolsado)} reembolsado`
        : `${moedaPainel(vendas.descontos)} em descontos`
    },
    {
      rotulo: 'Pedidos pagos',
      valor: vendas.pedidos_pagos.toLocaleString('pt-BR'),
      detalhe: `${vendas.pedidos_criados.toLocaleString('pt-BR')} pedidos criados`
    },
    {
      rotulo: 'Ticket médio',
      valor: moedaPainel(vendas.ticket_medio),
      detalhe: `Frete cobrado: ${moedaPainel(vendas.frete_cobrado)}`
    },
    {
      rotulo: 'Conversão do pagamento',
      valor: percentual(vendas.conversao_pagamento),
      detalhe: 'Pedidos criados que foram pagos'
    },
    {
      rotulo: 'Cancelamentos',
      valor: percentual(vendas.taxa_cancelamento),
      detalhe: `${vendas.pedidos_cancelados} pedido(s) cancelado(s)`
    },
    {
      rotulo: 'Clientes',
      valor: clientes.compradores.toLocaleString('pt-BR'),
      detalhe: `${clientes.novos} cadastro(s) novo(s) · ${clientes.recorrentes} recorrente(s)`
    }
  ];

  $dash('dash-kpis').innerHTML = kpis.map(kpi => `
    <article class="dash-kpi">
      <span>${escaparHtmlPainel(kpi.rotulo)}</span>
      <strong>${escaparHtmlPainel(kpi.valor)}</strong>
      <small>${escaparHtmlPainel(kpi.detalhe)}</small>
    </article>`).join('');
}


/* =============================================================
   GRÁFICO DE COLUNAS (SVG)
============================================================= */

function renderizarGrafico(serie) {

  const container = $dash('dash-grafico');
  const largura = Math.max(container.clientWidth, 320);
  const altura = 260;
  const margem = { topo: 16, direita: 12, base: 28, esquerda: 72 };

  const areaL = largura - margem.esquerda - margem.direita;
  const areaA = altura - margem.topo - margem.base;

  const maximo = Math.max(...serie.map(d => d.faturamento), 0);

  // Escala "redonda" com 4 divisões
  const passoBruto = maximo > 0 ? maximo / 4 : 25;
  const potencia = 10 ** Math.floor(Math.log10(passoBruto));
  const passo = [1, 2, 2.5, 5, 10].map(f => f * potencia).find(p => p >= passoBruto);
  const topo = passo * 4;

  const y = valor => margem.topo + areaA - (valor / topo) * areaA;

  const banda = areaL / serie.length;
  const espessura = Math.min(24, Math.max(2, banda - 2));
  const raio = Math.min(4, espessura / 2);

  const grade = [0, 1, 2, 3, 4].map(i => {
    const valor = passo * i;
    return `
      <line x1="${margem.esquerda}" x2="${largura - margem.direita}" y1="${y(valor)}" y2="${y(valor)}" class="dash-grade${i === 0 ? ' base' : ''}"/>
      <text x="${margem.esquerda - 8}" y="${y(valor) + 4}" text-anchor="end" class="dash-eixo">${moedaCurta(valor)}</text>`;
  }).join('');

  // Rótulos do eixo X sem sobreposição
  const cadaN = Math.ceil(serie.length / Math.floor(areaL / 56));

  const colunas = serie.map((d, i) => {

    const xBanda = margem.esquerda + i * banda;
    const x = xBanda + (banda - espessura) / 2;
    const yTopo = y(d.faturamento);
    const base = y(0);
    const h = base - yTopo;

    // Topo arredondado (4px) e base reta
    const barra = h > 0
      ? `<path d="M${x},${base} V${yTopo + Math.min(raio, h)} Q${x},${yTopo} ${x + Math.min(raio, h)},${yTopo} H${x + espessura - Math.min(raio, h)} Q${x + espessura},${yTopo} ${x + espessura},${yTopo + Math.min(raio, h)} V${base} Z" fill="${COR_SERIE}" class="dash-barra"/>`
      : '';

    const rotulo = i % cadaN === 0
      ? `<text x="${xBanda + banda / 2}" y="${altura - 8}" text-anchor="middle" class="dash-eixo">${rotuloDia(d.dia)}</text>`
      : '';

    // Área de toque maior que a barra: a coluna inteira
    return `
      <g class="dash-coluna" data-indice="${i}">
        <rect x="${xBanda}" y="${margem.topo}" width="${banda}" height="${areaA}" class="dash-alvo"/>
        ${barra}
      </g>
      ${rotulo}`;
  }).join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${largura} ${altura}" width="100%" height="${altura}" role="img"
         aria-label="Faturamento por dia no período. Máximo de ${moedaPainel(maximo)} em um dia. Veja a tabela abaixo para os valores.">
      ${grade}
      ${colunas}
    </svg>
    <div class="dash-tooltip" id="dash-tooltip" hidden></div>`;

  const tooltip = $dash('dash-tooltip');

  container.querySelectorAll('.dash-coluna').forEach(coluna => {

    function mostrar() {

      const d = serie[Number(coluna.dataset.indice)];
      const alvo = coluna.querySelector('.dash-alvo');
      const caixa = alvo.getBoundingClientRect();
      const base = container.getBoundingClientRect();

      container.querySelectorAll('.dash-coluna').forEach(c => c.classList.remove('ativa'));
      coluna.classList.add('ativa');

      tooltip.innerHTML = `
        <strong>${rotuloDia(d.dia, true)}</strong>
        <span><i style="background:${COR_SERIE}"></i>${moedaPainel(d.faturamento)}</span>
        <small>${d.pedidos} pedido(s) pago(s)</small>`;

      tooltip.hidden = false;

      const esquerda = caixa.left - base.left + caixa.width / 2 - tooltip.offsetWidth / 2;
      tooltip.style.left = `${Math.max(0, Math.min(esquerda, base.width - tooltip.offsetWidth))}px`;
      tooltip.style.top = '0px';
    }

    coluna.addEventListener('mouseenter', mostrar);
    coluna.addEventListener('click', mostrar);
  });

  container.querySelector('svg').addEventListener('mouseleave', () => {
    tooltip.hidden = true;
    container.querySelectorAll('.dash-coluna').forEach(c => c.classList.remove('ativa'));
  });

  // Tabela acessível com os mesmos dados
  $dash('dash-tabela').innerHTML = serie
    .filter(d => d.pedidos > 0)
    .map(d => `
      <tr>
        <td>${rotuloDia(d.dia, true)}</td>
        <td>${d.pedidos}</td>
        <td>${moedaPainel(d.faturamento)}</td>
      </tr>`).join('') || '<tr><td colspan="3">Sem vendas no período.</td></tr>';
}


/* =============================================================
   RANKINGS
============================================================= */

function renderizarRanking(id, linhas, campoNome) {

  $dash(id).innerHTML = linhas.length === 0
    ? '<tr><td colspan="3" class="admin-muted-text">Sem vendas no período.</td></tr>'
    : linhas.map(linha => `
      <tr>
        <td>${escaparHtmlPainel(linha[campoNome])}</td>
        <td>${Number(linha.quantidade)}</td>
        <td>${moedaPainel(linha.faturamento)}</td>
      </tr>`).join('');
}


/* =============================================================
   FILTRO DE PERÍODO
============================================================= */

document.querySelectorAll('.dash-periodo').forEach(botao => {

  botao.addEventListener('click', () => {

    diasPeriodo = Number(botao.dataset.dias);

    document.querySelectorAll('.dash-periodo').forEach(b => {
      const ativo = b === botao;
      b.classList.toggle('ativo', ativo);
      b.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    });

    carregarDashboard();
  });
});


let redimensionar = null;

window.addEventListener('resize', () => {
  clearTimeout(redimensionar);
  redimensionar = setTimeout(carregarDashboard, 250);
});


carregarDashboard();
