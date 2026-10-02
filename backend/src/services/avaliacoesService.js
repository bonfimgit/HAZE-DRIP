/*
  Avaliações de produtos.
  Só quem recebeu o produto (pedido entregue) pode avaliar:
  avaliação de compra verificada, uma por cliente e produto.
*/

const db = require('../config/db');
const { naoEncontrado, proibido } = require('../utils/erros');


async function resumoProduto(produtoId, { pagina = 1, limite = 10 } = {}) {

  const [[resumo]] = await db.query(
    `SELECT ROUND(AVG(nota), 1) AS media, COUNT(*) AS total
     FROM avaliacoes
     WHERE produto_id = ? AND visivel = TRUE`,
    [produtoId]
  );

  const [distribuicao] = await db.query(
    `SELECT nota, COUNT(*) AS total
     FROM avaliacoes
     WHERE produto_id = ? AND visivel = TRUE
     GROUP BY nota`,
    [produtoId]
  );

  // Só o primeiro nome do cliente é exibido
  const [avaliacoes] = await db.query(
    `SELECT
        a.id,
        a.nota,
        a.titulo,
        a.comentario,
        a.criado_em,
        SUBSTRING_INDEX(c.nome, ' ', 1) AS cliente_nome
     FROM avaliacoes a
     INNER JOIN clientes c ON c.id = a.cliente_id
     WHERE a.produto_id = ? AND a.visivel = TRUE
     ORDER BY a.criado_em DESC, a.id DESC
     LIMIT ? OFFSET ?`,
    [produtoId, limite, (pagina - 1) * limite]
  );

  const porNota = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  distribuicao.forEach(linha => { porNota[linha.nota] = Number(linha.total); });

  return {
    media: resumo.media != null ? Number(resumo.media) : null,
    total: Number(resumo.total),
    distribuicao: porNota,
    avaliacoes
  };
}


// Pedido entregue do cliente que contém o produto
async function pedidoQueComprova(clienteId, produtoId) {

  const [pedidos] = await db.query(
    `SELECT p.id
     FROM pedidos p
     INNER JOIN pedidos_itens i ON i.pedido_id = p.id
     WHERE p.cliente_id = ?
     AND i.produto_id = ?
     AND p.status = 'entregue'
     ORDER BY p.id DESC
     LIMIT 1`,
    [clienteId, produtoId]
  );

  return pedidos[0]?.id || null;
}


/*
  Cria ou atualiza a avaliação do cliente para o produto.
*/
async function salvar(clienteId, { produtoId, nota, titulo, comentario }) {

  const pedidoId = await pedidoQueComprova(clienteId, produtoId);

  if (!pedidoId) {
    throw proibido('Você pode avaliar este produto depois de recebê-lo.');
  }

  await db.query(
    `INSERT INTO avaliacoes (produto_id, cliente_id, pedido_id, nota, titulo, comentario)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       nota = VALUES(nota),
       titulo = VALUES(titulo),
       comentario = VALUES(comentario)`,
    [produtoId, clienteId, pedidoId, nota, titulo, comentario]
  );

  const [[avaliacao]] = await db.query(
    'SELECT * FROM avaliacoes WHERE cliente_id = ? AND produto_id = ?',
    [clienteId, produtoId]
  );

  return avaliacao;
}


// Produtos recebidos pelo cliente, com a avaliação (se já fez)
async function doCliente(clienteId) {

  const [linhas] = await db.query(
    `SELECT
        i.produto_id,
        MAX(i.produto_nome) AS produto_nome,
        MAX(p.entregue_em) AS entregue_em,
        a.id AS avaliacao_id,
        a.nota,
        a.titulo,
        a.comentario
     FROM pedidos p
     INNER JOIN pedidos_itens i ON i.pedido_id = p.id
     LEFT JOIN avaliacoes a ON a.produto_id = i.produto_id AND a.cliente_id = p.cliente_id
     WHERE p.cliente_id = ?
     AND p.status = 'entregue'
     GROUP BY i.produto_id, a.id, a.nota, a.titulo, a.comentario
     ORDER BY entregue_em DESC`,
    [clienteId]
  );

  return linhas;
}


/* =============================================================
   ADMIN
============================================================= */

async function listarAdmin({ pagina = 1, limite = 50 } = {}) {

  const [avaliacoes] = await db.query(
    `SELECT
        a.*,
        pr.nome AS produto_nome,
        c.nome AS cliente_nome,
        c.email AS cliente_email
     FROM avaliacoes a
     INNER JOIN produtos pr ON pr.id = a.produto_id
     INNER JOIN clientes c ON c.id = a.cliente_id
     ORDER BY a.criado_em DESC, a.id DESC
     LIMIT ? OFFSET ?`,
    [limite, (pagina - 1) * limite]
  );

  return avaliacoes;
}


async function alterarVisibilidade(id, visivel) {

  const [resultado] = await db.query(
    'UPDATE avaliacoes SET visivel = ? WHERE id = ?',
    [visivel, id]
  );

  if (resultado.affectedRows === 0) {
    throw naoEncontrado('Avaliação não encontrada');
  }
}


module.exports = {
  resumoProduto,
  salvar,
  doCliente,
  listarAdmin,
  alterarVisibilidade
};
