/*
  Carrega o .env (quando existir) e centraliza as configurações.
  Em produção (Render) as variáveis já vêm do ambiente.
*/

/*
  Fuso da loja: datas de pedidos e relatórios em horário de Brasília,
  mesmo com o servidor (Render) em UTC.
*/
process.env.TZ = process.env.TZ || 'America/Sao_Paulo';

const { loadEnvFile } = require('node:process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Nos testes o .env de desenvolvimento não é carregado (ambiente isolado)
if (process.env.NODE_ENV !== 'test') {
  try {
    loadEnvFile(path.join(__dirname, '..', '..', '.env'));
  } catch (erro) {
    if (erro.code !== 'ENOENT') {
      throw erro;
    }
  }
}

function lista(valor) {
  return (valor || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizarOrigem(valor) {
  try {
    return new URL(valor).origin;
  } catch {
    return valor.replace(/\/+$/, '');
  }
}

// Preenchida por sslBanco(); exibida no início das migrações
let descricaoSsl = 'sem SSL (DB_SSL_CA, DB_SSL_CA_FILE e DB_SSL vazios)';

const config = {

  ambiente: process.env.NODE_ENV || 'development',

  porta: Number(process.env.PORT) || 3000,

  jwtSecret: process.env.JWT_SECRET,

  // Só a origem (protocolo + domínio + porta): tolera barra final e caminho
  origensPermitidas: lista(process.env.FRONTEND_URLS).map(normalizarOrigem),

  // URL pública da loja, usada em links de e-mail e retorno do pagamento
  urlLoja: (process.env.STORE_URL || '').replace(/\/+$/, ''),

  // URL pública da API, usada no webhook do Mercado Pago
  urlApi: (process.env.API_URL || '').replace(/\/+$/, ''),

  db: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: sslBanco()
  },

  cloudinary: {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  }
};

config.descricaoSslBanco = descricaoSsl;
config.emTeste = config.ambiente === 'test';
config.emProducao = config.ambiente === 'production';

/*
  SSL do banco (exigido por serviços gerenciados como o Aiven).
  Formas de informar o certificado CA (.pem), em ordem de preferência:
  - DB_SSL_CA_FILE: caminho do arquivo (ex.: Secret File do Render,
    /etc/secrets/ca.pem)
  - DB_SSL_CA: conteúdo do .pem; aceita as quebras de linha reais ou
    escritas como "\n", e ignora aspas em volta
  DB_SSL=true sem CA: SSL validando pelos certificados públicos.
*/
function sslBanco() {

  let ca = '';
  let origem = 'DB_SSL_CA';

  if (process.env.DB_SSL_CA_FILE) {
    origem = 'DB_SSL_CA_FILE';
    try {
      ca = fs.readFileSync(process.env.DB_SSL_CA_FILE, 'utf8');
    } catch (erro) {
      throw new Error(`DB_SSL_CA_FILE: não foi possível ler ${process.env.DB_SSL_CA_FILE} (${erro.code || erro.message})`);
    }
  } else if (process.env.DB_SSL_CA) {
    ca = process.env.DB_SSL_CA;
  }

  ca = ca
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\\r/g, '')
    .replace(/\\n/g, '\n')
    .replace(/\r/g, '')
    .trim();

  if (ca) {
    // Falha cedo e com mensagem clara se o certificado estiver incompleto
    try {
      new crypto.X509Certificate(ca);
    } catch {
      throw new Error(
        `${origem} inválido: cole o CA certificate do Aiven inteiro, ` +
        'de -----BEGIN CERTIFICATE----- até -----END CERTIFICATE-----'
      );
    }
    const cert = new crypto.X509Certificate(ca);
    descricaoSsl = `SSL com CA de ${origem} (${cert.subject.replace(/\n/g, ', ')}; válido até ${cert.validTo})`;
    return { ca, rejectUnauthorized: true };
  }

  if (process.env.DB_SSL === 'true') {
    descricaoSsl = 'SSL com certificados públicos (DB_SSL=true, sem CA própria)';
    return { rejectUnauthorized: true };
  }

  return undefined;
}

module.exports = config;
