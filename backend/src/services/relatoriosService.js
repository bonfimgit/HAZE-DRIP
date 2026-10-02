/*
  Indicadores do negócio e exportações.

  "Venda" = pedido com pagamento confirmado: status pago, em
  preparação, enviado ou entregue. Faturamento líquido desconta
  valores reembolsados.
*/

const db = require('../config/db');
const { requisicaoInvalida } = require('../utils/erros');
const { arredondar } = require('../utils/dinheiro');

const STATUS_VENDA = ['pago', 'em_preparacao', 'enviado', 'entregue'];
const SQL_VENDA = `p.status IN ('pago', 'em_preparacao', 'enviado', 'entregue')`;

const MAX_DIAS = 366;


/*
  Período [de, ate] em datas (AAAA-MM-DD). Padrão: últimos 30 dias.
*/
function lerPeriodo({ de, ate } = {}) {

  const hoje = new Date();
  const fim = ate ? new Date(`${ate}T23:59:59`) : hoje;
  const inicio = de
    ? new Date(`${de}T00:00:00`)
    : new Date(fim.getTime() - 29 * 24 * 60 * 60 * 1000);

  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) {
    throw requisicaoInvalida('Período inválido');
  }

  inicio.setHours(0, 0, 0, 0);
  fim.setHours(23, 59, 59, 999);

  if (fim < inicio) {
    throw requisicaoInvalida('A data final deve ser depois da inicial');
  }

  if ((fim - inicio) / 86400000 > MAX_DIAS) {
    throw requisicaoInvalida(`O período pode ter no máximo ${MAX_DIAS} dias`);
  }

  return { inicio, fim };
}


async function dashboard(filtro) {

  const { inicio, fim } = lerPeriodo(filtro);
  const periodo = [inicio, fim];

  const [[resumo]] = await db.query(
    `SELECT
        COUNT(*) AS pedidos_criados,
        SUM(${SQL_VENDA}) AS pedidos_pagos,
        SUM(p.status = 'cancelado') AS pedidos_cancelados,
        COALESCE(SUM(CASE WHEN ${SQL_VENDA} THEN p.total END), 0) AS faturamento_bruto,
        COALESCE(SUM(p.valor_reembolsado), 0) AS reembolsado,
        COALESCE(SUM(CASE WHEN ${SQL_VENDA} THEN p.desconto END), 0) AS descontos,
        COALESCE(SUM(CASE WHEN ${SQL_VENDA} THEN p.frete END), 0) AS frete_cobrado
     FROM pedidos p
     WHERE p.criado_em BETWEEN ? AND ?`,
    periodo
  );

  const pedidosPagos = Number(resumo.pedidos_pagos || 0);
  const pedidosCriados = Number(resumo.pedidos_criados || 0);
  const faturamentoBruto = Number(resumo.faturamento_bruto);
  const faturamento = arredondar(faturamentoBruto - Number(resumo.reembolsado));

  // Vendas por dia (série para o gráfico)
  const [porDia] = await db.query(
    `SELECT
        DATE(p.criado_em) AS dia,
        COUNT(*) AS pedidos,
        COALESCE(SUM(p.total), 0) AS faturamento
     FROM pedidos p
     WHERE ${SQL_VENDA}
     AND p.criado_em BETWEEN ? AND ?
     GROUP BY DATE(p.criado_em)
     ORDER BY dia ASC`,
    periodo
  );

  const mapaDias = new Map(
    porDia.map(linha => [formatarDia(linha.dia), linha])
  );

  const serie = [];

  for (let dia = new Date(inicio); dia <= fim; dia.setDate(dia.getDate() + 1)) {
    const chave = formatarDia(dia);
    const linha = mapaDias.get(chave);
    serie.push({
      dia: chave,
      pedidos: linha ? Number(linha.pedidos) : 0,
      faturamento: linha ? arredondar(linha.faturamento) : 0
    });
  }

  const [maisVendidos] = await db.query(
    `SELECT
        i.produto_id,
        i.produto_nome,
        SUM(i.quantidade) AS quantidade,
        SUM(i.subtotal) AS faturamento
     FROM pedidos_itens i
     INNER JOIN pedidos p ON p.id = i.pedido_id
     WHERE ${SQL_VENDA}
     AND p.criado_em BETWEEN ? AND ?
     GROUP BY i.produto_id, i.produto_nome
     ORDER BY quantidade DESC, faturamento DESC
     LIMIT 10`,
    periodo
  );

  const [categorias] = await db.query(
    `SELECT
        COALESCE(c.nome, 'Sem categoria') AS categoria,
        SUM(i.quantidade) AS quantidade,
        SUM(i.subtotal) AS faturamento
     FROM pedidos_itens i
     INNER JOIN pedidos p ON p.id = i.pedido_id
     LEFT JOIN produtos pr ON pr.id = i.produto_id
     LEFT JOIN categorias c ON c.id = pr.categoria_id
     WHERE ${SQL_VENDA}
     AND p.criado_em BETWEEN ? AND ?
     GROUP BY c.nome
     ORDER BY faturamento DESC`,
    periodo
  );

  const [[clientes]] = await db.query(
    `SELECT
        (SELECT COUNT(*) FROM clientes
         WHERE excluido_em IS NULL AND criado_em BETWEEN ? AND ?) AS novos,
        (SELECT COUNT(*) FROM (
           SELECT p.cliente_email
           FROM pedidos p
           WHERE ${SQL_VENDA}
           AND p.criado_em BETWEEN ? AND ?
           GROUP BY p.cliente_email
         ) compradores) AS compradores,
        (SELECT COUNT(*) FROM (
           SELECT p.cliente_email
           FROM pedidos p
           WHERE ${SQL_VENDA}
           GROUP BY p.cliente_email
           HAVING COUNT(*) >= 2
           AND MAX(p.criado_em) BETWEEN ? AND ?
         ) recorrentes) AS recorrentes`,
    [...periodo, ...periodo, ...periodo]
  );

  const [[operacao]] = await db.query(
    `SELECT
        (SELECT COUNT(*) FROM pedidos WHERE status = 'aguardando_pagamento') AS aguardando_pagamento,
        (SELECT COUNT(*) FROM pedidos WHERE status IN ('pago', 'em_preparacao')) AS para_enviar,
        (SELECT COUNT(*) FROM produto_variacoes v
         INNER JOIN produtos pr ON pr.id = v.produto_id
         WHERE v.ativo = TRUE AND pr.ativo = TRUE
         AND v.estoque <= GREATEST(v.estoque_minimo, 0)) AS estoque_baixo,
        (SELECT COUNT(*) FROM produtos WHERE ativo = TRUE) AS produtos_ativos,
        (SELECT COUNT(*) FROM produtos WHERE ativo = TRUE AND destaque_home = TRUE) AS produtos_destaque,
        (SELECT COUNT(*) FROM pedidos WHERE pagamento_status IN ('valor_divergente', 'aprovado_apos_cancelamento')) AS pagamentos_com_problema`
  );

  return {
    periodo: { de: formatarDia(inicio), ate: formatarDia(fim) },
    vendas: {
      faturamento,
      faturamento_bruto: arredondar(faturamentoBruto),
      reembolsado: arredondar(resumo.reembolsado),
      descontos: arredondar(resumo.descontos),
      frete_cobrado: arredondar(resumo.frete_cobrado),
      pedidos_criados: pedidosCriados,
      pedidos_pagos: pedidosPagos,
      pedidos_cancelados: Number(resumo.pedidos_cancelados || 0),
      ticket_medio: pedidosPagos ? arredondar(faturamentoBruto / pedidosPagos) : 0,
      // Pedidos criados que chegaram a ser pagos (conversão do checkout)
      conversao_pagamento: pedidosCriados ? arredondar((pedidosPagos / pedidosCriados) * 100) : 0,
      taxa_cancelamento: pedidosCriados ? arredondar((Number(resumo.pedidos_cancelados || 0) / pedidosCriados) * 100) : 0
    },
    clientes: {
      novos: Number(clientes.novos),
      compradores: Number(clientes.compradores),
      recorrentes: Number(clientes.recorrentes)
    },
    operacao: {
      aguardando_pagamento: Number(operacao.aguardando_pagamento),
      para_enviar: Number(operacao.para_enviar),
      estoque_baixo: Number(operacao.estoque_baixo),
      produtos_ativos: Number(operacao.produtos_ativos),
      produtos_destaque: Number(operacao.produtos_destaque),
      pagamentos_com_problema: Number(operacao.pagamentos_com_problema)
    },
    vendas_por_dia: serie,
    mais_vendidos: maisVendidos.map(linha => ({
      produto_id: linha.produto_id,
      produto_nome: linha.produto_nome,
      quantidade: Number(linha.quantidade),
      faturamento: arredondar(linha.faturamento)
    })),
    categorias: categorias.map(linha => ({
      categoria: linha.categoria,
      quantidade: Number(linha.quantidade),
      faturamento: arredondar(linha.faturamento)
    }))
  };
}


function formatarDia(data) {
  const d = new Date(data);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}


/* =============================================================
   EXPORTAÇÃO CSV (abre direto no Excel em português)
============================================================= */

function valorCsv(valor) {

  if (valor == null) {
    return '';
  }

  if (valor instanceof Date) {
    return valor.toLocaleString('pt-BR');
  }

  if (typeof valor === 'number') {
    return String(valor).replace('.', ',');
  }

  let texto = String(valor);

  // Evita que o Excel interprete o conteúdo como fórmula
  if (/^[=+\-@\t\r]/.test(texto)) {
    texto = `'${texto}`;
  }

  return /[";\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}


function gerarCsv(colunas, linhas) {

  const cabecalho = colunas.map(([, titulo]) => valorCsv(titulo)).join(';');

  const corpo = linhas.map(linha =>
    colunas.map(([chave]) => {
      const valor = linha[chave];
      return valorCsv(typeof valor === 'string' && /^-?\d+(\.\d+)?$/.test(valor) && chave !== 'sku' && chave !== 'telefone' ? Number(valor) : valor);
    }).join(';')
  );

  // BOM para o Excel reconhecer UTF-8 (acentos)
  return '﻿' + [cabecalho, ...corpo].join('\r\n');
}


const EXPORTACOES = {

  async pedidos(periodo) {

    const [linhas] = await db.query(
      `SELECT
          id, criado_em, status, pagamento_status, metodo_pagamento,
          cliente_nome, cliente_email, cliente_telefone,
          endereco_cidade, endereco_estado,
          subtotal, desconto, frete, total, valor_reembolsado,
          cupom_codigo, codigo_rastreio
       FROM pedidos
       WHERE criado_em BETWEEN ? AND ?
       ORDER BY id ASC`,
      [periodo.inicio, periodo.fim]
    );

    return gerarCsv([
      ['id', 'Pedido'], ['criado_em', 'Data'], ['status', 'Status'],
      ['pagamento_status', 'Pagamento'], ['metodo_pagamento', 'Forma'],
      ['cliente_nome', 'Cliente'], ['cliente_email', 'E-mail'], ['cliente_telefone', 'Telefone'],
      ['endereco_cidade', 'Cidade'], ['endereco_estado', 'UF'],
      ['subtotal', 'Subtotal'], ['desconto', 'Desconto'], ['frete', 'Frete'],
      ['total', 'Total'], ['valor_reembolsado', 'Reembolsado'],
      ['cupom_codigo', 'Cupom'], ['codigo_rastreio', 'Rastreio']
    ], linhas);
  },

  async itens(periodo) {

    const [linhas] = await db.query(
      `SELECT
          p.id AS pedido_id, p.criado_em, p.status,
          i.produto_nome, i.sku, i.cor, i.tamanho,
          i.quantidade, i.preco_unitario, i.preco_original, i.subtotal
       FROM pedidos_itens i
       INNER JOIN pedidos p ON p.id = i.pedido_id
       WHERE p.criado_em BETWEEN ? AND ?
       ORDER BY p.id ASC, i.id ASC`,
      [periodo.inicio, periodo.fim]
    );

    return gerarCsv([
      ['pedido_id', 'Pedido'], ['criado_em', 'Data'], ['status', 'Status'],
      ['produto_nome', 'Produto'], ['sku', 'SKU'], ['cor', 'Cor'], ['tamanho', 'Tamanho'],
      ['quantidade', 'Quantidade'], ['preco_unitario', 'Preço unitário'],
      ['preco_original', 'Preço sem promoção'], ['subtotal', 'Subtotal']
    ], linhas);
  },

  async estoque() {

    const [linhas] = await db.query(
      `SELECT
          p.nome AS produto_nome, v.sku, v.cor, v.tamanho, v.estoque,
          v.estoque_minimo, p.preco, (v.estoque * p.preco) AS valor_em_estoque,
          IF(v.ativo AND p.ativo, 'Sim', 'Não') AS ativo
       FROM produto_variacoes v
       INNER JOIN produtos p ON p.id = v.produto_id
       ORDER BY p.nome, v.cor, v.tamanho`
    );

    return gerarCsv([
      ['produto_nome', 'Produto'], ['sku', 'SKU'], ['cor', 'Cor'], ['tamanho', 'Tamanho'],
      ['estoque', 'Estoque'], ['estoque_minimo', 'Estoque mínimo'], ['preco', 'Preço'],
      ['valor_em_estoque', 'Valor em estoque'], ['ativo', 'Ativo']
    ], linhas);
  },

  async movimentacoes(periodo) {

    const [linhas] = await db.query(
      `SELECT
          m.criado_em, p.nome AS produto_nome, v.sku, m.tipo, m.quantidade,
          m.estoque_anterior, m.estoque_novo, m.motivo, m.pedido_id,
          a.nome AS admin_nome
       FROM estoque_movimentacoes m
       INNER JOIN produto_variacoes v ON v.id = m.variacao_id
       INNER JOIN produtos p ON p.id = v.produto_id
       LEFT JOIN usuarios_admin a ON a.id = m.admin_id
       WHERE m.criado_em BETWEEN ? AND ?
       ORDER BY m.id ASC`,
      [periodo.inicio, periodo.fim]
    );

    return gerarCsv([
      ['criado_em', 'Data'], ['produto_nome', 'Produto'], ['sku', 'SKU'], ['tipo', 'Tipo'],
      ['quantidade', 'Quantidade'], ['estoque_anterior', 'Antes'], ['estoque_novo', 'Depois'],
      ['motivo', 'Motivo'], ['pedido_id', 'Pedido'], ['admin_nome', 'Responsável']
    ], linhas);
  },

  async clientes() {

    const [linhas] = await db.query(
      `SELECT
          c.id, c.nome, c.email, c.telefone, c.criado_em,
          IF(c.email_verificado_em IS NULL, 'Não', 'Sim') AS email_verificado,
          IF(c.bloqueado, 'Sim', 'Não') AS bloqueado,
          COUNT(p.id) AS pedidos,
          COALESCE(SUM(CASE WHEN ${SQL_VENDA} THEN p.total END), 0) AS total_gasto
       FROM clientes c
       LEFT JOIN pedidos p ON p.cliente_id = c.id
       WHERE c.excluido_em IS NULL
       GROUP BY c.id
       ORDER BY c.id ASC`
    );

    return gerarCsv([
      ['id', 'ID'], ['nome', 'Nome'], ['email', 'E-mail'], ['telefone', 'Telefone'],
      ['criado_em', 'Cadastro'], ['email_verificado', 'E-mail confirmado'],
      ['bloqueado', 'Bloqueado'], ['pedidos', 'Pedidos'], ['total_gasto', 'Total gasto']
    ], linhas);
  }
};


async function exportar(tipo, filtro) {

  if (!EXPORTACOES[tipo]) {
    throw requisicaoInvalida('Relatório inválido');
  }

  return EXPORTACOES[tipo](lerPeriodo(filtro));
}


module.exports = {
  STATUS_VENDA,
  TIPOS_EXPORTACAO: Object.keys(EXPORTACOES),
  lerPeriodo,
  dashboard,
  exportar,
  gerarCsv
};
