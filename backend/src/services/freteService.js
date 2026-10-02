/*
  Frete por tabela própria.

  Cada regra vale para:
    - uma faixa de CEP (cep_inicio..cep_fim), ou
    - um estado (uf), ou
    - todo o Brasil (sem uf e sem faixa) — regra padrão.
  A regra mais específica vence: faixa de CEP > estado > padrão.
  "gratis_acima" zera o frete quando o valor dos produtos
  (já com desconto) atinge o mínimo.
*/

const db = require('../config/db');
const { naoEncontrado, requisicaoInvalida } = require('../utils/erros');
const { arredondar } = require('../utils/dinheiro');


function especificidade(regra) {
  if (regra.cep_inicio) return 3;
  if (regra.uf) return 2;
  return 1;
}


async function buscarRegra(cep, uf, conexao = db) {

  const cepNumeros = String(cep || '').replace(/\D/g, '');

  if (cepNumeros.length !== 8) {
    throw requisicaoInvalida('CEP inválido');
  }

  const [regras] = await conexao.query(
    `SELECT *
     FROM frete_regras
     WHERE ativo = TRUE
     AND (
       (cep_inicio IS NOT NULL AND ? BETWEEN cep_inicio AND cep_fim)
       OR (cep_inicio IS NULL AND uf = ?)
       OR (cep_inicio IS NULL AND uf IS NULL)
     )`,
    [cepNumeros, (uf || '').toUpperCase()]
  );

  if (regras.length === 0) {
    return null;
  }

  // Mais específica primeiro; empate: menor valor
  regras.sort((a, b) =>
    especificidade(b) - especificidade(a) || Number(a.valor) - Number(b.valor)
  );

  return regras[0];
}


/*
  Calcula o frete de um pedido.
  Lança erro se não houver regra que atenda o CEP.
*/
async function calcular({ cep, uf, valorProdutos, freteGratisCupom = false, conexao = db }) {

  const regra = await buscarRegra(cep, uf, conexao);

  if (!regra) {
    throw requisicaoInvalida('Ainda não entregamos para este CEP');
  }

  const gratisPorValor =
    regra.gratis_acima != null &&
    Number(valorProdutos) >= Number(regra.gratis_acima);

  const gratis = freteGratisCupom || gratisPorValor;

  return {
    regra_id: regra.id,
    descricao: regra.nome,
    valor: gratis ? 0 : arredondar(regra.valor),
    valor_original: arredondar(regra.valor),
    gratis,
    gratis_acima: regra.gratis_acima != null ? Number(regra.gratis_acima) : null,
    prazo_min_dias: regra.prazo_min_dias,
    prazo_max_dias: regra.prazo_max_dias
  };
}


/* =============================================================
   ADMIN
============================================================= */

async function listar() {
  const [regras] = await db.query(
    'SELECT * FROM frete_regras ORDER BY ativo DESC, uf IS NULL, uf, cep_inicio, id'
  );
  return regras;
}


async function buscar(id) {
  const [regras] = await db.execute('SELECT * FROM frete_regras WHERE id = ?', [id]);
  if (regras.length === 0) {
    throw naoEncontrado('Regra de frete não encontrada');
  }
  return regras[0];
}


async function salvar(id, dados) {

  const valores = [
    dados.nome,
    dados.uf,
    dados.cepInicio,
    dados.cepFim,
    dados.valor,
    dados.prazoMin,
    dados.prazoMax,
    dados.gratisAcima,
    dados.ativo
  ];

  if (id) {

    await buscar(id);

    await db.execute(
      `UPDATE frete_regras
       SET nome = ?, uf = ?, cep_inicio = ?, cep_fim = ?, valor = ?,
           prazo_min_dias = ?, prazo_max_dias = ?, gratis_acima = ?, ativo = ?
       WHERE id = ?`,
      [...valores, id]
    );

    return buscar(id);
  }

  const [resultado] = await db.execute(
    `INSERT INTO frete_regras
      (nome, uf, cep_inicio, cep_fim, valor, prazo_min_dias, prazo_max_dias, gratis_acima, ativo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    valores
  );

  return buscar(resultado.insertId);
}


async function remover(id) {
  const [resultado] = await db.execute('DELETE FROM frete_regras WHERE id = ?', [id]);
  if (resultado.affectedRows === 0) {
    throw naoEncontrado('Regra de frete não encontrada');
  }
}


module.exports = {
  buscarRegra,
  calcular,
  listar,
  buscar,
  salvar,
  remover
};
