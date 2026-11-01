const db = require('../config/db');
const { emTransacao } = require('../utils/transacao');
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


/*
  Edita a variação.
  - estoque null: mantém o estoque atual (salvar só SKU/cor/tamanho)
  - estoqueAnterior: valor que o painel mostrava; se uma venda mudou
    o estoque nesse meio-tempo, a edição é recusada (409)
  Tudo numa transação, com a variação travada: uma venda simultânea
  espera a edição terminar em vez de ter a baixa sobrescrita.
*/
async function atualizar(produtoId, variacaoId, { tamanho, cor, estoque, sku, ativo, estoqueAnterior = null }, adminId = null) {

  await emTransacao(async conexao => {

    const [variacoes] = await conexao.execute(
      `SELECT estoque
       FROM produto_variacoes
       WHERE id = ?
       AND produto_id = ?
       FOR UPDATE`,
      [variacaoId, produtoId]
    );

    if (variacoes.length === 0) {
      throw naoEncontrado('Variação não encontrada');
    }

    const atual = Number(variacoes[0].estoque);

    // Só confere quando o estoque está sendo alterado
    if (estoque != null) {
      estoqueService.conferirEstoqueAnterior(atual, estoqueAnterior);
    }

    const novo = estoque == null ? atual : estoque;

    try {
      await conexao.execute(
        `UPDATE produto_variacoes
         SET
            tamanho = ?,
            cor = ?,
            estoque = ?,
            sku = ?,
            ativo = ?
         WHERE id = ?
         AND produto_id = ?`,
        [tamanho, cor, novo, sku, ativo, variacaoId, produtoId]
      );
    } catch (erro) {
      throw tratarDuplicidade(erro, tamanho, cor);
    }

    if (atual !== novo) {
      await estoqueService.registrarMovimentacao(conexao, {
        variacaoId,
        tipo: 'ajuste',
        quantidade: novo - atual,
        estoqueAnterior: atual,
        estoqueNovo: novo,
        motivo: 'Edição da variação',
        adminId
      });
    }
  });

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
