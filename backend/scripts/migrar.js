/*
  Executa as migrações pendentes da pasta /migrations.

  Uso:
    npm run migrate

  Cada arquivo é executado uma única vez e registrado na tabela
  schema_migrations. FAÇA BACKUP do banco de produção antes de rodar.

  Primeiro administrador (banco novo): com ADMIN_EMAIL e ADMIN_SENHA
  definidos e nenhum administrador cadastrado, cria um gerente.
  Útil no Render, que não tem terminal no plano gratuito. Depois do
  primeiro login, apague essas variáveis.
*/

const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');

const db = require('../db');
const config = require('../src/config/ambiente');

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

  log(`Banco: ${config.db.host}:${config.db.port}/${config.db.database} — ${config.descricaoSslBanco}`);

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


/* =============================================================
   PRIMEIRO ADMINISTRADOR (só em banco sem nenhum admin)
============================================================= */

async function criarAdminInicial({ log = console.log } = {}) {

  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const senha = process.env.ADMIN_SENHA || '';
  const nome = (process.env.ADMIN_NOME || 'Gerente').trim();

  if (!email && !senha) {
    return;
  }

  if (!email || !senha) {
    log('Admin inicial: defina ADMIN_EMAIL e ADMIN_SENHA juntos. Nada foi criado.');
    return;
  }

  if (senha.length < 8) {
    log('Admin inicial: ADMIN_SENHA precisa ter pelo menos 8 caracteres. Nada foi criado.');
    return;
  }

  const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM usuarios_admin');

  if (Number(total) > 0) {
    log('Admin inicial: já existe administrador; ADMIN_EMAIL/ADMIN_SENHA ignorados (pode apagá-los).');
    return;
  }

  const senhaHash = await bcrypt.hash(senha, 12);

  await db.execute(
    `INSERT INTO usuarios_admin (nome, email, senha_hash, perfil)
     VALUES (?, ?, ?, 'gerente')`,
    [nome, email, senhaHash]
  );

  log(`Admin inicial criado: ${email} (gerente).`);
}


module.exports = { migrar, criarAdminInicial };


if (require.main === module) {

  migrar()
    .then(() => criarAdminInicial())
    .then(() => db.end())
    .catch(async erro => {
      console.error('Erro ao executar migrações:', erro.message);

      if (/certificate|self.signed|SSL|insecure transport/i.test(erro.message)) {
        console.error(
          'Dica: o banco exige SSL com o CA certificate do serviço (Aiven: aba Overview > CA certificate).\n' +
          'Use DB_SSL_CA (conteúdo do .pem) ou DB_SSL_CA_FILE (caminho do arquivo). Veja docs/DEPLOY.md.'
        );
      }

      await db.end();
      process.exit(1);
    });
}
