const db = require('../config/db');
const { emTransacao } = require('../utils/transacao');
const { naoEncontrado, requisicaoInvalida } = require('../utils/erros');

/*
  Tipos de movimentação:
    entrada       chegada de mercadoria (soma)
    ajuste        correção manual / inventário (define o valor)
    venda         baixa por pedido
    cancelamento  devolução por pedido cancelado
*/
const TIPOS = ['entrada', 'ajuste', 'venda', 'cancelamento'];


async function registrarMovimentacao(conexao, {
  variacaoId,
  tipo,
  quantidade,
  estoqueAnterior,
  estoqueNovo,
  motivo = null,
  pedidoId = null,
  adminId = null
}) {

  await conexao.execute(
    `INSERT INTO estoque_movimentacoes
      (variacao_id, tipo, quantidade, estoque_anterior, estoque_novo,
       motivo, pedido_id, admin_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      variacaoId,
      tipo,
      quantidade,
      estoqueAnterior,
      estoqueNovo,
      motivo,
      pedidoId,
      adminId
    ]
  );
}


/*
  Altera o estoque de uma variação e registra a movimentação.
  modo 'definir' = ajuste para um valor exato (inventário)
  modo 'somar'   = entrada de mercadoria
*/
async function alterar({ produtoId, variacaoId, modo, valor, motivo, adminId }) {

  return emTransacao(async conexao => {

    const [variacoes] = await conexao.execute(
      `SELECT *
       FROM produto_variacoes
       WHERE id = ?
       AND produto_id = ?
       FOR UPDATE`,
      [variacaoId, produtoId]
    );

    if (variacoes.length === 0) {
      throw naoEncontrado('Variação não encontrada');
    }

    const anterior = Number(variacoes[0].estoque);

    const novo = modo === 'somar'
      ? anterior + valor
      : valor;

    if (novo < 0) {
      throw requisicaoInvalida('O estoque não pode ficar negativo');
    }

    await conexao.execute(
      'UPDATE produto_variacoes SET estoque = ? WHERE id = ?',
      [novo, variacaoId]
    );

    if (novo !== anterior) {
      await registrarMovimentacao(conexao, {
        variacaoId,
        tipo: modo === 'somar' ? 'entrada' : 'ajuste',
        quantidade: novo - anterior,
        estoqueAnterior: anterior,
        estoqueNovo: novo,
        motivo,
        adminId
      });
    }

    const [atualizada] = await conexao.execute(
      'SELECT * FROM produto_variacoes WHERE id = ?',
      [variacaoId]
    );

    return atualizada[0];
  });
}


async function definirMinimo(produtoId, variacaoId, minimo) {

  const [resultado] = await db.execute(
    `UPDATE produto_variacoes
     SET estoque_minimo = ?
     WHERE id = ?
     AND produto_id = ?`,
    [minimo, variacaoId, produtoId]
  );

  if (resultado.affectedRows === 0) {
    throw naoEncontrado('Variação não encontrada');
  }
}


async function listarMovimentacoes({ variacaoId = null, produtoId = null, tipo = null, limite = 100, pagina = 1 }) {

  const filtros = [];
  const valores = [];

  if (variacaoId) {
    filtros.push('m.variacao_id = ?');
    valores.push(variacaoId);
  }

  if (produtoId) {
    filtros.push('v.produto_id = ?');
    valores.push(produtoId);
  }

  if (tipo) {
    filtros.push('m.tipo = ?');
    valores.push(tipo);
  }

  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';

  const [movimentacoes] = await db.query(
    `SELECT
        m.*,
        v.sku,
        v.cor,
        v.tamanho,
        v.produto_id,
        p.nome AS produto_nome,
        a.nome AS admin_nome
     FROM estoque_movimentacoes m
     INNER JOIN produto_variacoes v ON v.id = m.variacao_id
     INNER JOIN produtos p ON p.id = v.produto_id
     LEFT JOIN usuarios_admin a ON a.id = m.admin_id
     ${where}
     ORDER BY m.criado_em DESC, m.id DESC
     LIMIT ? OFFSET ?`,
    [...valores, limite, (pagina - 1) * limite]
  );

  return movimentacoes;
}


// Variações ativas com estoque menor ou igual ao mínimo definido
async function listarEstoqueBaixo() {

  const [variacoes] = await db.query(
    `SELECT
        v.id,
        v.produto_id,
        v.sku,
        v.cor,
        v.tamanho,
        v.estoque,
        v.estoque_minimo,
        p.nome AS produto_nome
     FROM produto_variacoes v
     INNER JOIN produtos p ON p.id = v.produto_id
     WHERE v.ativo = TRUE
     AND v.estoque <= GREATEST(v.estoque_minimo, 0)
     ORDER BY v.estoque ASC, p.nome ASC`
  );

  return variacoes;
}


// Inventário: posição atual de todas as variações
async function inventario() {

  const [linhas] = await db.query(
    `SELECT
        p.id AS produto_id,
        p.nome AS produto_nome,
        p.ativo AS produto_ativo,
        v.id AS variacao_id,
        v.sku,
        v.cor,
        v.tamanho,
        v.estoque,
        v.estoque_minimo,
        v.ativo AS variacao_ativa,
        p.preco,
        (v.estoque * p.preco) AS valor_em_estoque
     FROM produto_variacoes v
     INNER JOIN produtos p ON p.id = v.produto_id
     ORDER BY p.nome ASC, v.cor ASC, v.tamanho ASC`
  );

  return linhas;
}


module.exports = {
  TIPOS,
  registrarMovimentacao,
  alterar,
  definirMinimo,
  listarMovimentacoes,
  listarEstoqueBaixo,
  inventario
};
