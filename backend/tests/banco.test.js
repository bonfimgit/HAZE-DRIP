/*
  Compatibilidade do banco.
  Roda contra MySQL/MariaDB (local e CI) e contra TiDB (job do CI).
*/

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { prepararAmbiente, finalizarAmbiente, db } = require('./ajuda');

let api;

before(async () => {
  ({ api } = await prepararAmbiente());
});

after(async () => {
  await finalizarAmbiente(api);
});


async function ehTidb() {
  const [[{ versao }]] = await db.query('SELECT VERSION() AS versao');
  return /TiDB/i.test(versao);
}


test('TiDB: tabelas com ID automático usam AUTO_ID_CACHE=1 (IDs sempre crescentes)', async t => {

  if (!(await ehTidb())) {
    t.skip('banco não é TiDB');
    return;
  }

  const [tabelas] = await db.query(
    `SELECT TABLE_NAME AS nome
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND EXTRA LIKE '%auto_increment%'`
  );

  assert.ok(tabelas.length >= 20, `só ${tabelas.length} tabelas com auto_increment`);

  for (const { nome } of tabelas) {
    const [[linha]] = await db.query(`SHOW CREATE TABLE \`${nome}\``);
    assert.match(linha['Create Table'], /AUTO_ID_CACHE=1/, `tabela ${nome} sem AUTO_ID_CACHE=1`);
  }
});


test('IDs de pagamentos crescem na ordem de criação', async () => {

  const [[pedido]] = await db.query(
    `SELECT id FROM pedidos LIMIT 1`
  );

  // Banco recém-migrado: cria um pedido mínimo só para os pagamentos
  let pedidoId = pedido?.id;

  if (!pedidoId) {
    const [novo] = await db.query(
      `INSERT INTO pedidos (status, cliente_nome, cliente_email, cliente_telefone,
         endereco_cep, endereco_rua, endereco_numero, endereco_bairro, endereco_cidade, endereco_estado,
         subtotal, frete, total)
       VALUES ('aguardando_pagamento', 'Teste', 't@teste.com', '35999999999',
         '37900000', 'Rua', '1', 'Centro', 'Passos', 'MG', 10, 0, 10)`
    );
    pedidoId = novo.insertId;
  }

  const ids = [];

  for (let i = 0; i < 20; i++) {
    const [r] = await db.query(
      `INSERT INTO pagamentos (pedido_id, provedor, provedor_id, tipo, status, valor)
       VALUES (?, 'mercadopago', ?, 'pagamento', 'pendente', 10)`,
      [pedidoId, `ordem-${i}`]
    );
    ids.push(r.insertId);
  }

  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
});


test('textos comparados sem diferenciar maiúsculas (collation explícita)', async () => {

  const [colunas] = await db.query(
    `SELECT TABLE_NAME AS tabela, COLUMN_NAME AS coluna, COLLATION_NAME AS collation
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME <> 'schema_migrations'
     AND COLLATION_NAME IS NOT NULL`
  );

  assert.ok(colunas.length > 0);

  const diferentes = colunas.filter(c => c.collation !== 'utf8mb4_general_ci');
  assert.deepEqual(diferentes, []);

  const [[{ igual }]] = await db.query("SELECT 'Camiseta' = 'camiseta' COLLATE utf8mb4_general_ci AS igual");
  assert.equal(Number(igual), 1);
});
