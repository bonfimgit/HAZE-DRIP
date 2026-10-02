/*
  Catálogo da loja: busca, filtros, ordenação, paginação,
  facetas (para a barra de filtros) e produtos relacionados.

  Filtros e ordenação de preço usam o preço efetivo (com a
  promoção vigente), o mesmo que o cliente vê e paga.
*/

const db = require('../config/db');
const promocoesService = require('./promocoesService');
const { CAMPANHA_VIGENTE } = promocoesService;

const ORDENS = {
  recentes: 'p.criado_em DESC, p.id DESC',
  menor_preco: 'preco_efetivo ASC, p.id DESC',
  maior_preco: 'preco_efetivo DESC, p.id DESC',
  nome: 'p.nome ASC',
  mais_vendidos: 'vendidos DESC, p.criado_em DESC',
  avaliacao: 'avaliacao_media IS NULL, avaliacao_media DESC, avaliacao_total DESC'
};

const MAX_LIMITE = 48;


// Base: produtos ativos com preço efetivo, vendas e avaliações
const BASE = `
  SELECT
    p.*,
    c.nome AS categoria_nome,
    (
      SELECT pi.url
      FROM produto_imagens pi
      WHERE pi.produto_id = p.id
      AND pi.principal = TRUE
      LIMIT 1
    ) AS imagem_principal,
    ROUND(p.preco * (1 - COALESCE((
      SELECT MAX(c2.desconto_percentual)
      FROM campanha_produtos cp
      INNER JOIN campanhas c2 ON c2.id = cp.campanha_id
      WHERE cp.produto_id = p.id
      AND c2.desconto_percentual > 0
      AND ${CAMPANHA_VIGENTE.replace(/\bc\./g, 'c2.')}
    ), 0) / 100), 2) AS preco_efetivo,
    (
      SELECT COALESCE(SUM(i.quantidade), 0)
      FROM pedidos_itens i
      INNER JOIN pedidos pe ON pe.id = i.pedido_id
      WHERE i.produto_id = p.id
      AND pe.status IN ('pago', 'em_preparacao', 'enviado', 'entregue')
    ) AS vendidos,
    (
      SELECT ROUND(AVG(a.nota), 1)
      FROM avaliacoes a
      WHERE a.produto_id = p.id AND a.visivel = TRUE
    ) AS avaliacao_media,
    (
      SELECT COUNT(*)
      FROM avaliacoes a
      WHERE a.produto_id = p.id AND a.visivel = TRUE
    ) AS avaliacao_total,
    (
      SELECT COALESCE(SUM(v.estoque), 0)
      FROM produto_variacoes v
      WHERE v.produto_id = p.id AND v.ativo = TRUE
    ) AS estoque_total
  FROM produtos p
  LEFT JOIN categorias c ON c.id = p.categoria_id
  WHERE p.ativo = TRUE
`;


function montarFiltros(filtros) {

  const condicoes = [];
  const valores = [];

  if (filtros.busca) {
    condicoes.push('(base.nome LIKE ? OR base.descricao LIKE ? OR base.categoria_nome LIKE ?)');
    const termo = `%${filtros.busca}%`;
    valores.push(termo, termo, termo);
  }

  if (filtros.categorias?.length) {
    condicoes.push('base.categoria_id IN (?)');
    valores.push(filtros.categorias);
  }

  if (filtros.tamanhos?.length) {
    condicoes.push(`EXISTS (
      SELECT 1 FROM produto_variacoes v
      WHERE v.produto_id = base.id AND v.ativo = TRUE AND v.estoque > 0 AND v.tamanho IN (?)
    )`);
    valores.push(filtros.tamanhos);
  }

  if (filtros.cores?.length) {
    condicoes.push(`EXISTS (
      SELECT 1 FROM produto_variacoes v
      WHERE v.produto_id = base.id AND v.ativo = TRUE AND v.estoque > 0 AND v.cor IN (?)
    )`);
    valores.push(filtros.cores);
  }

  if (filtros.precoMin != null) {
    condicoes.push('base.preco_efetivo >= ?');
    valores.push(filtros.precoMin);
  }

  if (filtros.precoMax != null) {
    condicoes.push('base.preco_efetivo <= ?');
    valores.push(filtros.precoMax);
  }

  if (filtros.promocao) {
    condicoes.push('base.preco_efetivo < base.preco');
  }

  if (filtros.disponivel) {
    condicoes.push('base.estoque_total > 0');
  }

  return {
    where: condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '',
    valores
  };
}


function limparProduto(produto) {

  const {
    preco_efetivo: _efetivo,
    ...resto
  } = produto;

  return {
    ...resto,
    vendidos: Number(produto.vendidos),
    avaliacao_media: produto.avaliacao_media != null ? Number(produto.avaliacao_media) : null,
    avaliacao_total: Number(produto.avaliacao_total),
    estoque_total: Number(produto.estoque_total)
  };
}


async function buscar(filtros) {

  const pagina = filtros.pagina || 1;
  const limite = Math.min(filtros.limite || 12, MAX_LIMITE);
  const ordem = ORDENS[filtros.ordem] || ORDENS.recentes;

  const { where, valores } = montarFiltros(filtros);

  // "p." da ordenação vira "base." (consulta externa)
  const ordemExterna = ordem.replace(/\bp\./g, 'base.');

  const [produtos] = await db.query(
    `SELECT * FROM (${BASE}) AS base
     ${where}
     ORDER BY ${ordemExterna}
     LIMIT ? OFFSET ?`,
    [...valores, limite, (pagina - 1) * limite]
  );

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM (${BASE}) AS base ${where}`,
    valores
  );

  const comPromocao = await promocoesService.aplicarEmProdutos(produtos.map(limparProduto));

  return {
    produtos: comPromocao,
    total: Number(total),
    pagina,
    limite,
    paginas: Math.max(1, Math.ceil(Number(total) / limite))
  };
}


/*
  Opções para a barra de filtros, com contagem de produtos.
*/
async function facetas() {

  const [categorias] = await db.query(
    `SELECT c.id, c.nome, COUNT(p.id) AS total
     FROM categorias c
     INNER JOIN produtos p ON p.categoria_id = c.id AND p.ativo = TRUE
     WHERE c.ativo = TRUE
     GROUP BY c.id, c.nome
     ORDER BY c.nome`
  );

  const [tamanhos] = await db.query(
    `SELECT v.tamanho AS valor, COUNT(DISTINCT v.produto_id) AS total
     FROM produto_variacoes v
     INNER JOIN produtos p ON p.id = v.produto_id AND p.ativo = TRUE
     WHERE v.ativo = TRUE AND v.estoque > 0
     GROUP BY v.tamanho`
  );

  const [cores] = await db.query(
    `SELECT v.cor AS valor, COUNT(DISTINCT v.produto_id) AS total
     FROM produto_variacoes v
     INNER JOIN produtos p ON p.id = v.produto_id AND p.ativo = TRUE
     WHERE v.ativo = TRUE AND v.estoque > 0
     GROUP BY v.cor
     ORDER BY v.cor`
  );

  const [[faixa]] = await db.query(
    `SELECT MIN(preco_efetivo) AS minimo, MAX(preco_efetivo) AS maximo
     FROM (${BASE}) AS base`
  );

  // Ordem natural de tamanhos de roupa
  const ORDEM_TAMANHO = ['PP', 'P', 'M', 'G', 'GG', 'XG', 'XGG', 'U', 'ÚNICO'];

  tamanhos.sort((a, b) => {
    const ia = ORDEM_TAMANHO.indexOf(String(a.valor).toUpperCase());
    const ib = ORDEM_TAMANHO.indexOf(String(b.valor).toUpperCase());
    if (ia !== -1 || ib !== -1) {
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    }
    return String(a.valor).localeCompare(String(b.valor), 'pt-BR', { numeric: true });
  });

  return {
    categorias: categorias.map(c => ({ ...c, total: Number(c.total) })),
    tamanhos: tamanhos.map(t => ({ valor: t.valor, total: Number(t.total) })),
    cores: cores.map(c => ({ valor: c.valor, total: Number(c.total) })),
    preco: {
      minimo: faixa.minimo != null ? Number(faixa.minimo) : 0,
      maximo: faixa.maximo != null ? Number(faixa.maximo) : 0
    }
  };
}


/*
  Mesma categoria primeiro (mais vendidos), completando com
  outros produtos se a categoria tiver poucos.
*/
async function relacionados(produtoId, limite = 4) {

  const [[produto]] = await db.query(
    'SELECT categoria_id FROM produtos WHERE id = ?',
    [produtoId]
  );

  if (!produto) {
    return [];
  }

  const [linhas] = await db.query(
    `SELECT * FROM (${BASE}) AS base
     WHERE base.id <> ?
     AND base.estoque_total > 0
     ORDER BY (base.categoria_id = ?) DESC, base.vendidos DESC, base.criado_em DESC
     LIMIT ?`,
    [produtoId, produto.categoria_id, limite]
  );

  return promocoesService.aplicarEmProdutos(linhas.map(limparProduto));
}


module.exports = {
  ORDENS,
  MAX_LIMITE,
  buscar,
  facetas,
  relacionados
};
