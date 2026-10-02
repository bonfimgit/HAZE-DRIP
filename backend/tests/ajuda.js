/*
  Utilitários compartilhados pelos testes.

  Requer um MySQL/MariaDB de teste. Variáveis (com padrões):
    TEST_DB_HOST=127.0.0.1  TEST_DB_PORT=3306
    TEST_DB_USER=haze       TEST_DB_PASSWORD=haze
    TEST_DB_NAME=haze_drip_test

  ATENÇÃO: o banco de teste é APAGADO a cada execução.
*/

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'segredo-de-teste';
process.env.DB_HOST = process.env.TEST_DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.TEST_DB_PORT || '3306';
process.env.DB_USER = process.env.TEST_DB_USER || 'haze';
process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD || 'haze';
process.env.DB_NAME = process.env.TEST_DB_NAME || 'haze_drip_test';
process.env.FRONTEND_URLS = 'http://loja.teste';
process.env.STORE_URL = 'http://loja.teste';
process.env.API_URL = 'http://api.teste';

if (!/test/.test(process.env.DB_NAME)) {
  throw new Error('Por segurança, o banco de teste precisa ter "test" no nome.');
}

const bcrypt = require('bcryptjs');

const db = require('../src/config/db');
const cloudinary = require('../src/config/cloudinary');
const { migrar } = require('../scripts/migrar');
const { criarApp } = require('../src/app');


/* =============================================================
   CLOUDINARY SIMULADO
============================================================= */

let contadorImagens = 0;
const imagensRemovidas = [];

cloudinary.uploader.upload_stream = (opcoes, callback) => ({
  end() {
    contadorImagens++;
    callback(null, {
      secure_url: `https://cdn.teste/${opcoes.folder}/img-${contadorImagens}.jpg`,
      public_id: `${opcoes.folder}/img-${contadorImagens}`
    });
  }
});

cloudinary.uploader.destroy = async publicId => {
  imagensRemovidas.push(publicId);
  return { result: 'ok' };
};


/* =============================================================
   BANCO
============================================================= */

async function resetarBanco() {

  const [tabelas] = await db.query(
    `SELECT TABLE_NAME AS nome
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()`
  );

  await db.query('SET FOREIGN_KEY_CHECKS = 0');

  for (const { nome } of tabelas) {
    await db.query(`DROP TABLE IF EXISTS \`${nome}\``);
  }

  await db.query('SET FOREIGN_KEY_CHECKS = 1');

  await migrar({ silencioso: true });
}


const ADMIN = {
  email: 'gerente@teste.com',
  senha: 'SenhaForte123'
};


/*
  Dados básicos:
  - categoria "Camisetas"
  - produto ativo com foto principal e duas variações
  - administrador gerente
*/
async function popularBanco() {

  const [categoria] = await db.query(
    "INSERT INTO categorias (nome) VALUES ('Camisetas')"
  );

  const [produto] = await db.query(
    `INSERT INTO produtos (nome, descricao, preco, categoria_id, ativo, destaque_home)
     VALUES ('Camiseta Haze', 'Algodão', 100.00, ?, TRUE, TRUE)`,
    [categoria.insertId]
  );

  await db.query(
    `INSERT INTO produto_imagens (produto_id, url, principal)
     VALUES (?, 'https://cdn.teste/foto.jpg', TRUE)`,
    [produto.insertId]
  );

  const [variacaoP] = await db.query(
    `INSERT INTO produto_variacoes (produto_id, tamanho, cor, estoque, sku)
     VALUES (?, 'P', 'Preto', 5, 'CAM-PRE-P')`,
    [produto.insertId]
  );

  const [variacaoM] = await db.query(
    `INSERT INTO produto_variacoes (produto_id, tamanho, cor, estoque, sku)
     VALUES (?, 'M', 'Preto', 2, 'CAM-PRE-M')`,
    [produto.insertId]
  );

  const senhaHash = await bcrypt.hash(ADMIN.senha, 4);

  const [admin] = await db.query(
    `INSERT INTO usuarios_admin (nome, email, senha_hash, perfil)
     VALUES ('Gerente Teste', ?, ?, 'gerente')`,
    [ADMIN.email, senhaHash]
  );

  return {
    categoriaId: categoria.insertId,
    produtoId: produto.insertId,
    variacaoPId: variacaoP.insertId,
    variacaoMId: variacaoM.insertId,
    adminId: admin.insertId
  };
}


/* =============================================================
   SERVIDOR E REQUISIÇÕES
============================================================= */

async function iniciarServidor() {

  const app = criarApp();

  const servidor = await new Promise(resolve => {
    const s = app.listen(0, () => resolve(s));
  });

  const base = `http://127.0.0.1:${servidor.address().port}`;

  async function requisicao(metodo, caminho, { corpo, token, cabecalhos = {}, form } = {}) {

    const headers = { ...cabecalhos };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    let body;

    if (form) {
      body = form;
    } else if (corpo !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
    }

    const resposta = await fetch(`${base}${caminho}`, {
      method: metodo,
      headers,
      body
    });

    const texto = await resposta.text();

    let dados = texto;

    try {
      dados = JSON.parse(texto);
    } catch {}

    return { status: resposta.status, dados, headers: resposta.headers };
  }

  return {
    base,
    get: (caminho, opcoes) => requisicao('GET', caminho, opcoes),
    post: (caminho, corpo, opcoes = {}) => requisicao('POST', caminho, { ...opcoes, corpo }),
    put: (caminho, corpo, opcoes = {}) => requisicao('PUT', caminho, { ...opcoes, corpo }),
    patch: (caminho, corpo, opcoes = {}) => requisicao('PATCH', caminho, { ...opcoes, corpo }),
    delete: (caminho, opcoes) => requisicao('DELETE', caminho, opcoes),
    enviar: (metodo, caminho, form, opcoes = {}) => requisicao(metodo, caminho, { ...opcoes, form }),
    encerrar: () => new Promise(resolve => servidor.close(resolve))
  };
}


async function loginAdmin(api) {

  const resposta = await api.post('/admin/login', {
    email: ADMIN.email,
    senha: ADMIN.senha
  });

  if (resposta.status !== 200) {
    throw new Error(`Login admin falhou: ${JSON.stringify(resposta.dados)}`);
  }

  return resposta.dados.token;
}


function pedidoValido(itens) {
  return {
    cliente: {
      nome: 'Cliente Teste',
      email: 'cliente@teste.com',
      telefone: '(35) 99999-9999'
    },
    endereco: {
      cep: '37900-000',
      rua: 'Rua A',
      numero: '10',
      complemento: '',
      bairro: 'Centro',
      cidade: 'Passos',
      estado: 'mg'
    },
    itens
  };
}


async function estoqueDe(variacaoId) {
  const [linhas] = await db.query(
    'SELECT estoque FROM produto_variacoes WHERE id = ?',
    [variacaoId]
  );
  return Number(linhas[0].estoque);
}


/*
  Prepara um arquivo de teste completo: banco limpo,
  dados básicos, servidor e token do administrador.
*/
async function prepararAmbiente() {

  await resetarBanco();

  const ids = await popularBanco();
  const api = await iniciarServidor();
  const tokenAdmin = await loginAdmin(api);

  return { ids, api, tokenAdmin };
}


async function finalizarAmbiente(api) {
  await api.encerrar();
  await db.end();
}


module.exports = {
  db,
  ADMIN,
  imagensRemovidas,
  resetarBanco,
  popularBanco,
  iniciarServidor,
  loginAdmin,
  pedidoValido,
  estoqueDe,
  prepararAmbiente,
  finalizarAmbiente
};
