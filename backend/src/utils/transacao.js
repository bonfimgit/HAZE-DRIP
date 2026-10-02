const db = require('../config/db');

/*
  Executa "funcao" dentro de uma transação.
  Commit se tudo der certo; rollback se qualquer erro for lançado.
*/
async function emTransacao(funcao) {

  const conexao = await db.getConnection();

  try {

    await conexao.beginTransaction();

    const resultado = await funcao(conexao);

    await conexao.commit();

    return resultado;

  } catch (erro) {

    try {
      await conexao.rollback();
    } catch {}

    throw erro;

  } finally {

    conexao.release();
  }
}

module.exports = { emTransacao };
