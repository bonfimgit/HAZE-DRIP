/*
  Carrega o .env (quando existir) e centraliza as configurações.
  Em produção (Railway) as variáveis já vêm do ambiente.
*/

/*
  Fuso da loja: datas de pedidos e relatórios em horário de Brasília,
  mesmo com o servidor (Railway) em UTC.
*/
process.env.TZ = process.env.TZ || 'America/Sao_Paulo';

const { loadEnvFile } = require('node:process');
const path = require('path');

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

const config = {

  ambiente: process.env.NODE_ENV || 'development',

  porta: Number(process.env.PORT) || 3000,

  jwtSecret: process.env.JWT_SECRET,

  origensPermitidas: lista(process.env.FRONTEND_URLS),

  // URL pública da loja, usada em links de e-mail e retorno do pagamento
  urlLoja: (process.env.STORE_URL || '').replace(/\/+$/, ''),

  // URL pública da API, usada no webhook do Mercado Pago
  urlApi: (process.env.API_URL || '').replace(/\/+$/, ''),

  db: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  },

  cloudinary: {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  }
};

config.emTeste = config.ambiente === 'test';
config.emProducao = config.ambiente === 'production';

module.exports = config;
