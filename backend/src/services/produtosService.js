const db = require('../config/db');
const { naoEncontrado, requisicaoInvalida } = require('../utils/erros');
const promocoesService = require('./promocoesService');

const SELECT_LISTAGEM = `
  SELECT
    p.*,
    c.nome AS categoria_nome,
    (
      SELECT pi.url
      FROM produto_imagens pi
      WHERE pi.produto_id = p.id
      AND pi.principal = TRUE
      LIMIT 1
    ) AS imagem_principal
  FROM produtos p
  LEFT JOIN categorias c
    ON c.id = p.categoria_id
`;


/* =============================================================
   LOJA
============================================================= */

async function listarAtivos() {

  const [produtos] = await db.query(`
    ${SELECT_LISTAGEM}
    WHERE p.ativo = TRUE
    ORDER BY p.criado_em DESC, p.id DESC
  `);

  return promocoesService.aplicarEmProdutos(produtos);
}


async function listarDestaques() {

  const [produtos] = await db.query(`
    ${SELECT_LISTAGEM}
    WHERE p.ativo = TRUE
    AND p.destaque_home = TRUE
    ORDER BY p.criado_em DESC, p.id DESC
  `);

  return promocoesService.aplicarEmProdutos(produtos);
}


async function buscarAtivo(produtoId) {

  const [produtos] = await db.execute(
    `SELECT
        p.*,
        c.nome AS categoria_nome
     FROM produtos p
     LEFT JOIN categorias c
       ON c.id = p.categoria_id
     WHERE p.id = ?
     AND p.ativo = TRUE`,
    [produtoId]
  );

  if (produtos.length === 0) {
    throw naoEncontrado('Produto não encontrado');
  }

  const [imagens] = await db.execute(
    `SELECT id, url, principal, ordem
     FROM produto_imagens
     WHERE produto_id = ?
     ORDER BY principal DESC, ordem ASC, id ASC`,
    [produtoId]
  );

  const [variacoes] = await db.execute(
    `SELECT id, tamanho, cor, estoque, sku
     FROM produto_variacoes
     WHERE produto_id = ?
     AND ativo = TRUE
     ORDER BY cor ASC, tamanho ASC`,
    [produtoId]
  );

  const estoqueTotal = variacoes.reduce(
    (total, variacao) => total + Number(variacao.estoque),
    0
  );

  const [produto] = await promocoesService.aplicarEmProdutos([produtos[0]]);

  return {
    ...produto,
    estoque_total: estoqueTotal,
    imagens,
    variacoes
  };
}


/* =============================================================
   ADMIN
============================================================= */

async function listarTodos() {

  const [produtos] = await db.query(`
    ${SELECT_LISTAGEM}
    ORDER BY p.criado_em DESC, p.id DESC
  `);

  return produtos;
}


async function buscarAdmin(produtoId) {

  const [produtos] = await db.execute(
    `SELECT
        p.*,
        c.nome AS categoria_nome
     FROM produtos p
     LEFT JOIN categorias c
       ON c.id = p.categoria_id
     WHERE p.id = ?`,
    [produtoId]
  );

  if (produtos.length === 0) {
    throw naoEncontrado('Produto não encontrado');
  }

  const [imagens] = await db.execute(
    `SELECT id, url, principal, ordem
     FROM produto_imagens
     WHERE produto_id = ?
     ORDER BY principal DESC, ordem ASC, id ASC`,
    [produtoId]
  );

  return {
    ...produtos[0],
    imagens
  };
}


async function garantirExiste(produtoId) {

  const [produtos] = await db.execute(
    'SELECT id FROM produtos WHERE id = ?',
    [produtoId]
  );

  if (produtos.length === 0) {
    throw naoEncontrado('Produto não encontrado');
  }
}


async function validarCategoriaAtiva(categoriaId) {

  const [categorias] = await db.execute(
    `SELECT id
     FROM categorias
     WHERE id = ?
     AND ativo = TRUE`,
    [categoriaId]
  );

  if (categorias.length === 0) {
    throw requisicaoInvalida('Categoria inválida ou inativa');
  }
}


/*
  Um produto só pode ficar ativo na loja se tiver foto principal,
  pelo menos uma variação ativa e estoque disponível.
  Devolve null se pode ser publicado ou o motivo se não pode.
*/
async function motivoParaNaoPublicar(produtoId) {

  const [imagens] = await db.execute(
    `SELECT id
     FROM produto_imagens
     WHERE produto_id = ?
     AND principal = TRUE
     LIMIT 1`,
    [produtoId]
  );

  if (imagens.length === 0) {
    return 'foto';
  }

  const [variacoes] = await db.execute(
    `SELECT estoque
     FROM produto_variacoes
     WHERE produto_id = ?
     AND ativo = TRUE`,
    [produtoId]
  );

  if (variacoes.length === 0) {
    return 'variacao';
  }

  if (!variacoes.some(variacao => Number(variacao.estoque) > 0)) {
    return 'estoque';
  }

  return null;
}


async function criar({ nome, descricao, preco, categoriaId, ativo, destaqueHome }) {

  await validarCategoriaAtiva(categoriaId);

  /*
    Um produto recém-criado ainda não tem foto, variações nem
    estoque. Por isso sempre nasce inativo.
  */
  const aviso = ativo
    ? 'Produto cadastrado como inativo: adicione foto principal, variações e estoque antes de ativá-lo.'
    : null;

  const [resultado] = await db.execute(
    `INSERT INTO produtos
      (nome, descricao, preco, categoria_id, ativo, destaque_home)
     VALUES (?, ?, ?, ?, FALSE, ?)`,
    [nome, descricao, preco, categoriaId, destaqueHome]
  );

  const [produtos] = await db.execute(
    'SELECT * FROM produtos WHERE id = ?',
    [resultado.insertId]
  );

  return {
    ...produtos[0],
    aviso
  };
}


const AVISOS_ATIVACAO = {
  foto: 'Dados salvos, mas o produto continua inativo: adicione uma foto principal.',
  variacao: 'Dados salvos, mas o produto continua inativo: adicione pelo menos uma variação ativa.',
  estoque: 'Dados salvos, mas o produto continua inativo: adicione estoque disponível.'
};


async function atualizar(produtoId, { nome, descricao, preco, categoriaId, ativo, destaqueHome }) {

  await validarCategoriaAtiva(categoriaId);

  let ativoFinal = ativo;
  let aviso = null;

  if (ativo) {

    const motivo = await motivoParaNaoPublicar(produtoId);

    if (motivo) {
      ativoFinal = false;
      aviso = AVISOS_ATIVACAO[motivo];
    }
  }

  const [resultado] = await db.execute(
    `UPDATE produtos
     SET
        nome = ?,
        descricao = ?,
        preco = ?,
        categoria_id = ?,
        ativo = ?,
        destaque_home = ?
     WHERE id = ?`,
    [nome, descricao, preco, categoriaId, ativoFinal, destaqueHome, produtoId]
  );

  if (resultado.affectedRows === 0) {
    throw naoEncontrado('Produto não encontrado');
  }

  const [produtos] = await db.execute(
    `SELECT
        p.*,
        c.nome AS categoria_nome
     FROM produtos p
     LEFT JOIN categorias c
       ON c.id = p.categoria_id
     WHERE p.id = ?`,
    [produtoId]
  );

  return {
    ...produtos[0],
    aviso
  };
}


async function desativar(produtoId) {

  const [resultado] = await db.execute(
    'UPDATE produtos SET ativo = FALSE WHERE id = ?',
    [produtoId]
  );

  if (resultado.affectedRows === 0) {
    throw naoEncontrado('Produto não encontrado');
  }
}


const MENSAGENS_REATIVACAO = {
  foto: 'O produto precisa ter uma foto principal antes de ser ativado.',
  variacao: 'O produto precisa ter pelo menos uma variação ativa antes de ser ativado.',
  estoque: 'O produto precisa ter estoque disponível antes de ser ativado.'
};


async function reativar(produtoId) {

  await garantirExiste(produtoId);

  const motivo = await motivoParaNaoPublicar(produtoId);

  if (motivo) {
    throw requisicaoInvalida(MENSAGENS_REATIVACAO[motivo]);
  }

  await db.execute(
    'UPDATE produtos SET ativo = TRUE WHERE id = ?',
    [produtoId]
  );

  const [produtos] = await db.execute(
    'SELECT * FROM produtos WHERE id = ?',
    [produtoId]
  );

  return produtos[0];
}


async function alterarDestaque(produtoId, destaque) {

  const [resultado] = await db.execute(
    'UPDATE produtos SET destaque_home = ? WHERE id = ?',
    [destaque, produtoId]
  );

  if (resultado.affectedRows === 0) {
    throw naoEncontrado('Produto não encontrado');
  }

  const [produtos] = await db.execute(
    `SELECT
        p.*,
        c.nome AS categoria_nome
     FROM produtos p
     LEFT JOIN categorias c
       ON c.id = p.categoria_id
     WHERE p.id = ?`,
    [produtoId]
  );

  return produtos[0];
}


module.exports = {
  listarAtivos,
  listarDestaques,
  buscarAtivo,
  listarTodos,
  buscarAdmin,
  garantirExiste,
  criar,
  atualizar,
  desativar,
  reativar,
  alterarDestaque
};
