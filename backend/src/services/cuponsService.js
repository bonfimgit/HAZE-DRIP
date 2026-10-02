/*
  Cupons de desconto.

  Tipos:
    percentual   valor = % sobre os produtos
    fixo         valor = R$ de desconto sobre os produtos
    frete_gratis zera o frete
*/

const db = require('../config/db');
const { naoEncontrado, requisicaoInvalida, conflito } = require('../utils/erros');
const { arredondar } = require('../utils/dinheiro');

const TIPOS = ['percentual', 'fixo', 'frete_gratis'];


function normalizarCodigo(codigo) {
  return String(codigo || '').trim().toUpperCase();
}


/*
  Valida o cupom para um pedido e calcula o desconto.
  Com "conexao" de uma transação, trava o cupom (FOR UPDATE)
  para que pedidos simultâneos não ultrapassem os limites.
*/
async function aplicar({ codigo, subtotal, clienteId = null, clienteEmail = null, conexao = db, travar = false }) {

  const [cupons] = await conexao.query(
    `SELECT *
     FROM cupons
     WHERE codigo = ?
     ${travar ? 'FOR UPDATE' : ''}`,
    [normalizarCodigo(codigo)]
  );

  const cupom = cupons[0];

  if (!cupom || !Number(cupom.ativo)) {
    throw requisicaoInvalida('Cupom inválido');
  }

  const agora = new Date();

  if (cupom.inicio_em && new Date(cupom.inicio_em) > agora) {
    throw requisicaoInvalida('Este cupom ainda não está valendo');
  }

  if (cupom.fim_em && new Date(cupom.fim_em) < agora) {
    throw requisicaoInvalida('Este cupom expirou');
  }

  if (cupom.limite_uso_total != null && Number(cupom.usos) >= Number(cupom.limite_uso_total)) {
    throw requisicaoInvalida('Este cupom atingiu o limite de usos');
  }

  if (cupom.valor_minimo != null && Number(subtotal) < Number(cupom.valor_minimo)) {
    throw requisicaoInvalida(
      `Cupom válido para compras a partir de ${Number(cupom.valor_minimo).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`
    );
  }

  if (cupom.limite_por_cliente != null && (clienteId || clienteEmail)) {

    const [usos] = await conexao.query(
      `SELECT COUNT(*) AS total
       FROM cupom_usos
       WHERE cupom_id = ?
       AND (cliente_email = ? OR (? IS NOT NULL AND cliente_id = ?))`,
      [cupom.id, clienteEmail, clienteId, clienteId]
    );

    if (Number(usos[0].total) >= Number(cupom.limite_por_cliente)) {
      throw requisicaoInvalida('Você já usou este cupom o número máximo de vezes');
    }
  }

  let desconto = 0;

  if (cupom.tipo === 'percentual') {
    desconto = arredondar(Number(subtotal) * Number(cupom.valor) / 100);
  } else if (cupom.tipo === 'fixo') {
    desconto = arredondar(Math.min(Number(cupom.valor), Number(subtotal)));
  }

  return {
    id: cupom.id,
    codigo: cupom.codigo,
    tipo: cupom.tipo,
    descricao: cupom.descricao,
    desconto,
    frete_gratis: cupom.tipo === 'frete_gratis'
  };
}


async function registrarUso(conexao, { cupomId, pedidoId, clienteId, clienteEmail }) {

  await conexao.execute(
    `INSERT INTO cupom_usos (cupom_id, pedido_id, cliente_id, cliente_email)
     VALUES (?, ?, ?, ?)`,
    [cupomId, pedidoId, clienteId, clienteEmail]
  );

  await conexao.execute(
    'UPDATE cupons SET usos = usos + 1 WHERE id = ?',
    [cupomId]
  );
}


// Pedido cancelado devolve o uso do cupom
async function liberarUso(conexao, pedidoId) {

  const [usos] = await conexao.execute(
    'SELECT cupom_id FROM cupom_usos WHERE pedido_id = ?',
    [pedidoId]
  );

  if (usos.length === 0) {
    return;
  }

  await conexao.execute('DELETE FROM cupom_usos WHERE pedido_id = ?', [pedidoId]);

  await conexao.execute(
    'UPDATE cupons SET usos = GREATEST(usos - 1, 0) WHERE id = ?',
    [usos[0].cupom_id]
  );
}


/* =============================================================
   ADMIN
============================================================= */

async function listar() {
  const [cupons] = await db.query('SELECT * FROM cupons ORDER BY criado_em DESC, id DESC');
  return cupons;
}


async function buscar(id) {
  const [cupons] = await db.execute('SELECT * FROM cupons WHERE id = ?', [id]);
  if (cupons.length === 0) {
    throw naoEncontrado('Cupom não encontrado');
  }
  return cupons[0];
}


async function salvar(id, dados) {

  const valores = [
    normalizarCodigo(dados.codigo),
    dados.descricao,
    dados.tipo,
    dados.valor,
    dados.valorMinimo,
    dados.inicioEm,
    dados.fimEm,
    dados.limiteTotal,
    dados.limitePorCliente,
    dados.ativo
  ];

  try {

    if (id) {

      await buscar(id);

      await db.execute(
        `UPDATE cupons
         SET codigo = ?, descricao = ?, tipo = ?, valor = ?, valor_minimo = ?,
             inicio_em = ?, fim_em = ?, limite_uso_total = ?, limite_por_cliente = ?, ativo = ?
         WHERE id = ?`,
        [...valores, id]
      );

      return buscar(id);
    }

    const [resultado] = await db.execute(
      `INSERT INTO cupons
        (codigo, descricao, tipo, valor, valor_minimo, inicio_em, fim_em,
         limite_uso_total, limite_por_cliente, ativo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      valores
    );

    return buscar(resultado.insertId);

  } catch (erro) {

    if (erro.code === 'ER_DUP_ENTRY') {
      throw conflito('Já existe um cupom com esse código');
    }

    throw erro;
  }
}


module.exports = {
  TIPOS,
  normalizarCodigo,
  aplicar,
  registrarUso,
  liberarUso,
  listar,
  buscar,
  salvar
};
