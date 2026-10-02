const db = require('../config/db');
const { naoEncontrado, conflito } = require('../utils/erros');


async function listarAtivas() {

  const [categorias] = await db.execute(
    `SELECT id, nome
     FROM categorias
     WHERE ativo = TRUE
     ORDER BY nome ASC`
  );

  return categorias;
}


async function listarTodas() {

  const [categorias] = await db.execute(
    `SELECT id, nome, ativo, criado_em
     FROM categorias
     ORDER BY nome ASC`
  );

  return categorias;
}


async function buscar(id) {

  const [categorias] = await db.execute(
    'SELECT * FROM categorias WHERE id = ?',
    [id]
  );

  if (categorias.length === 0) {
    throw naoEncontrado('Categoria não encontrada');
  }

  return categorias[0];
}


function tratarDuplicidade(erro) {
  return erro.code === 'ER_DUP_ENTRY'
    ? conflito('Já existe uma categoria com esse nome')
    : erro;
}


async function criar(nome) {

  try {
    const [resultado] = await db.execute(
      'INSERT INTO categorias (nome) VALUES (?)',
      [nome]
    );
    return buscar(resultado.insertId);
  } catch (erro) {
    throw tratarDuplicidade(erro);
  }
}


async function renomear(id, nome) {

  let resultado;

  try {
    [resultado] = await db.execute(
      'UPDATE categorias SET nome = ? WHERE id = ?',
      [nome, id]
    );
  } catch (erro) {
    throw tratarDuplicidade(erro);
  }

  if (resultado.affectedRows === 0) {
    throw naoEncontrado('Categoria não encontrada');
  }

  return buscar(id);
}


async function alterarAtivo(id, ativo) {

  const [resultado] = await db.execute(
    'UPDATE categorias SET ativo = ? WHERE id = ?',
    [ativo, id]
  );

  if (resultado.affectedRows === 0) {
    throw naoEncontrado('Categoria não encontrada');
  }
}


module.exports = {
  listarAtivas,
  listarTodas,
  buscar,
  criar,
  renomear,
  alterarAtivo
};
