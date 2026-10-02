const db = require('../config/db');
const { emTransacao } = require('../utils/transacao');
const { naoEncontrado, requisicaoInvalida } = require('../utils/erros');

const MAX_ENDERECOS = 10;


async function listar(clienteId) {

  const [enderecos] = await db.execute(
    `SELECT *
     FROM cliente_enderecos
     WHERE cliente_id = ?
     ORDER BY principal DESC, id ASC`,
    [clienteId]
  );

  return enderecos;
}


async function buscar(clienteId, enderecoId) {

  const [enderecos] = await db.execute(
    'SELECT * FROM cliente_enderecos WHERE id = ? AND cliente_id = ?',
    [enderecoId, clienteId]
  );

  if (enderecos.length === 0) {
    throw naoEncontrado('Endereço não encontrado');
  }

  return enderecos[0];
}


async function criar(clienteId, dados) {

  return emTransacao(async conexao => {

    const [existentes] = await conexao.execute(
      'SELECT id FROM cliente_enderecos WHERE cliente_id = ? FOR UPDATE',
      [clienteId]
    );

    if (existentes.length >= MAX_ENDERECOS) {
      throw requisicaoInvalida(`Você pode cadastrar até ${MAX_ENDERECOS} endereços`);
    }

    // O primeiro endereço é sempre o principal
    const principal = existentes.length === 0 || dados.principal;

    if (principal) {
      await conexao.execute(
        'UPDATE cliente_enderecos SET principal = FALSE WHERE cliente_id = ?',
        [clienteId]
      );
    }

    const [resultado] = await conexao.execute(
      `INSERT INTO cliente_enderecos
        (cliente_id, apelido, destinatario, cep, rua, numero,
         complemento, bairro, cidade, estado, principal)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        clienteId,
        dados.apelido,
        dados.destinatario,
        dados.cep,
        dados.rua,
        dados.numero,
        dados.complemento,
        dados.bairro,
        dados.cidade,
        dados.estado,
        principal
      ]
    );

    const [criado] = await conexao.execute(
      'SELECT * FROM cliente_enderecos WHERE id = ?',
      [resultado.insertId]
    );

    return criado[0];
  });
}


async function atualizar(clienteId, enderecoId, dados) {

  await buscar(clienteId, enderecoId);

  await db.execute(
    `UPDATE cliente_enderecos
     SET apelido = ?, destinatario = ?, cep = ?, rua = ?, numero = ?,
         complemento = ?, bairro = ?, cidade = ?, estado = ?
     WHERE id = ?
     AND cliente_id = ?`,
    [
      dados.apelido,
      dados.destinatario,
      dados.cep,
      dados.rua,
      dados.numero,
      dados.complemento,
      dados.bairro,
      dados.cidade,
      dados.estado,
      enderecoId,
      clienteId
    ]
  );

  if (dados.principal) {
    await definirPrincipal(clienteId, enderecoId);
  }

  return buscar(clienteId, enderecoId);
}


async function definirPrincipal(clienteId, enderecoId) {

  await buscar(clienteId, enderecoId);

  await db.execute(
    `UPDATE cliente_enderecos
     SET principal = (id = ?)
     WHERE cliente_id = ?`,
    [enderecoId, clienteId]
  );

  return listar(clienteId);
}


async function remover(clienteId, enderecoId) {

  await emTransacao(async conexao => {

    const [enderecos] = await conexao.execute(
      'SELECT * FROM cliente_enderecos WHERE id = ? AND cliente_id = ? FOR UPDATE',
      [enderecoId, clienteId]
    );

    if (enderecos.length === 0) {
      throw naoEncontrado('Endereço não encontrado');
    }

    await conexao.execute(
      'DELETE FROM cliente_enderecos WHERE id = ?',
      [enderecoId]
    );

    // Se era o principal, o mais antigo restante assume
    if (Number(enderecos[0].principal)) {
      await conexao.execute(
        `UPDATE cliente_enderecos
         SET principal = TRUE
         WHERE cliente_id = ?
         ORDER BY id ASC
         LIMIT 1`,
        [clienteId]
      );
    }
  });
}


module.exports = {
  listar,
  buscar,
  criar,
  atualizar,
  definirPrincipal,
  remover
};
