const db = require('../config/db');
const { naoEncontrado, conflito } = require('../utils/erros');
const produtosService = require('./produtosService');
const estoqueService = require('./estoqueService');


async function listarAtivas(produtoId) {

  const [variacoes] = await db.execute(
    `SELECT
        id,
        produto_id,
        tamanho,
        cor,
        estoque,
        sku,
        ativo,
        criado_em
     FROM produto_variacoes
     WHERE produto_id = ?
     AND ativo = TRUE
     ORDER BY cor ASC, tamanho ASC`,
    [produtoId]
  );

  return variacoes;
}


async function listarTodas(produtoId) {

  const [variacoes] = await db.execute(
    `SELECT *
     FROM produto_variacoes
     WHERE produto_id = ?
     ORDER BY cor ASC, tamanho ASC`,
    [produtoId]
  );

  return variacoes;
}


async function buscar(produtoId, variacaoId) {

  const [variacoes] = await db.execute(
    `SELECT *
     FROM produto_variacoes
     WHERE id = ?
     AND produto_id = ?`,
    [variacaoId, produtoId]
  );

  if (variacoes.length === 0) {
    throw naoEncontrado('Variação não encontrada');
  }

  return variacoes[0];
}


function tratarDuplicidade(erro, tamanho, cor) {

  if (erro.code !== 'ER_DUP_ENTRY') {
    return erro;
  }

  const mensagem = erro.message.toLowerCase();

  if (mensagem.includes('sku')) {
    return conflito('Este SKU já está sendo utilizado');
  }

  if (mensagem.includes('uq_produto_tamanho_cor')) {
    return conflito(`Já existe uma variação ${tamanho} / ${cor} para este produto`);
  }

  return conflito('Já existe uma variação com esses dados');
}


async function criar(produtoId, { tamanho, cor, estoque, sku }, adminId = null) {

  await produtosService.garantirExiste(produtoId);

  let resultado;

  try {
    [resultado] = await db.execute(
      `INSERT INTO produto_variacoes
        (produto_id, tamanho, cor, estoque, sku)
       VALUES (?, ?, ?, ?, ?)`,
      [produtoId, tamanho, cor, estoque, sku]
    );
  } catch (erro) {
    throw tratarDuplicidade(erro, tamanho, cor);
  }

  if (estoque > 0) {
    await estoqueService.registrarMovimentacao(db, {
      variacaoId: resultado.insertId,
      tipo: 'entrada',
      quantidade: estoque,
      estoqueAnterior: 0,
      estoqueNovo: estoque,
      motivo: 'Estoque inicial da variação',
      adminId
    });
  }

  return buscar(produtoId, resultado.insertId);
}


async function atualizar(produtoId, variacaoId, { tamanho, cor, estoque, sku, ativo }, adminId = null) {

  const anterior = await buscar(produtoId, variacaoId);

  try {
    await db.execute(
      `UPDATE produto_variacoes
       SET
          tamanho = ?,
          cor = ?,
          estoque = ?,
          sku = ?,
          ativo = ?
       WHERE id = ?
       AND produto_id = ?`,
      [tamanho, cor, estoque, sku, ativo, variacaoId, produtoId]
    );
  } catch (erro) {
    throw tratarDuplicidade(erro, tamanho, cor);
  }

  if (Number(anterior.estoque) !== estoque) {
    await estoqueService.registrarMovimentacao(db, {
      variacaoId,
      tipo: 'ajuste',
      quantidade: estoque - Number(anterior.estoque),
      estoqueAnterior: Number(anterior.estoque),
      estoqueNovo: estoque,
      motivo: 'Edição da variação',
      adminId
    });
  }

  return buscar(produtoId, variacaoId);
}


async function alterarAtivo(produtoId, variacaoId, ativo) {

  const [resultado] = await db.execute(
    `UPDATE produto_variacoes
     SET ativo = ?
     WHERE id = ?
     AND produto_id = ?`,
    [ativo, variacaoId, produtoId]
  );

  if (resultado.affectedRows === 0) {
    throw naoEncontrado('Variação não encontrada');
  }

  return buscar(produtoId, variacaoId);
}


module.exports = {
  listarAtivas,
  listarTodas,
  buscar,
  criar,
  atualizar,
  alterarAtivo
};
