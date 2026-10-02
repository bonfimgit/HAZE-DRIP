/*
  Executa as migrações pendentes da pasta /migrations.

  Uso:
    npm run migrate

  Cada arquivo é executado uma única vez e registrado na tabela
  schema_migrations. FAÇA BACKUP do banco de produção antes de rodar.
*/

const path = require('path');
const fs = require('fs');

const db = require('../db');

const PASTA_MIGRACOES = path.join(__dirname, '..', 'migrations');


/* =============================================================
   AUXILIARES DISPONÍVEIS PARA AS MIGRAÇÕES
   Permitem alterar tabelas existentes sem falhar se a coluna,
   o índice ou a chave já existirem (banco de produção).
============================================================= */

function criarAuxiliares(conexao) {

  async function colunaExiste(tabela, coluna) {
    const [linhas] = await conexao.query(
      `SELECT 1
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
      [tabela, coluna]
    );
    return linhas.length > 0;
  }

  async function indiceExiste(tabela, indice) {
    const [linhas] = await conexao.query(
      `SELECT 1
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?`,
      [tabela, indice]
    );
    return linhas.length > 0;
  }

  async function adicionarColuna(tabela, coluna, definicao) {
    if (!(await colunaExiste(tabela, coluna))) {
      await conexao.query(
        `ALTER TABLE \`${tabela}\` ADD COLUMN \`${coluna}\` ${definicao}`
      );
    }
  }

  async function adicionarIndice(tabela, indice, definicao) {
    if (!(await indiceExiste(tabela, indice))) {
      await conexao.query(
        `ALTER TABLE \`${tabela}\` ADD ${definicao}`
      );
    }
  }

  return {
    colunaExiste,
    indiceExiste,
    adicionarColuna,
    adicionarIndice
  };
}


async function migrar({ silencioso = false } = {}) {

  const log = silencioso ? () => {} : console.log;

  const conexao = await db.getConnection();

  try {

    await conexao.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        nome VARCHAR(150) PRIMARY KEY,
        executado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const [executadas] = await conexao.query(
      'SELECT nome FROM schema_migrations'
    );

    const jaExecutadas = new Set(
      executadas.map(linha => linha.nome)
    );

    const arquivos = fs
      .readdirSync(PASTA_MIGRACOES)
      .filter(arquivo => arquivo.endsWith('.js'))
      .sort();

    const auxiliares = criarAuxiliares(conexao);

    let quantidade = 0;

    for (const arquivo of arquivos) {

      if (jaExecutadas.has(arquivo)) {
        continue;
      }

      const migracao = require(
        path.join(PASTA_MIGRACOES, arquivo)
      );

      log(`Executando ${arquivo} — ${migracao.descricao || ''}`);

      // DDL no MySQL faz commit implícito, então cada migração
      // precisa ser escrita para poder ser reexecutada com segurança.
      await migracao.up(conexao, auxiliares);

      await conexao.query(
        'INSERT INTO schema_migrations (nome) VALUES (?)',
        [arquivo]
      );

      quantidade++;
    }

    log(
      quantidade === 0
        ? 'Nenhuma migração pendente.'
        : `${quantidade} migração(ões) executada(s).`
    );

  } finally {

    conexao.release();
  }
}


module.exports = { migrar };


if (require.main === module) {

  migrar()
    .then(() => db.end())
    .catch(async erro => {
      console.error('Erro ao executar migrações:', erro.message);
      await db.end();
      process.exit(1);
    });
}
