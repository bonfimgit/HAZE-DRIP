const express = require('express');
const cors = require('cors');

const config = require('./config/ambiente');
const db = require('./config/db');
const { auditoria } = require('./middlewares/auditoria');
const { tratarErros, rotaNaoEncontrada } = require('./middlewares/tratarErros');

const rotasCatalogo = require('./routes/loja/catalogo');
const rotasPedidosLoja = require('./routes/loja/pedidos');
const rotasAuthAdmin = require('./routes/admin/auth');
const rotasProdutosAdmin = require('./routes/admin/produtos');
const rotasCategoriasAdmin = require('./routes/admin/categorias');
const rotasCampanhasAdmin = require('./routes/admin/campanhas');
const rotasPedidosAdmin = require('./routes/admin/pedidos');
const rotasEstoqueAdmin = require('./routes/admin/estoque');


function criarApp() {

  const app = express();

  // Railway fica atrás de proxy: usa o IP real do cliente em req.ip
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(cors({
    origin(origem, callback) {

      // Sem Origin: curl, PowerShell, webhooks de pagamento
      if (!origem || config.origensPermitidas.includes(origem)) {
        return callback(null, true);
      }

      const erro = new Error('Origem não permitida pelo CORS');
      erro.status = 403;
      callback(erro);
    }
  }));

  app.use(express.json({ limit: '100kb' }));

  // Imagens antigas, salvas em disco antes da migração para o Cloudinary
  app.use('/uploads', express.static('uploads'));

  app.use(auditoria);


  app.get('/', (req, res) => {
    res.send('API Haze Drip funcionando!');
  });

  app.get('/health', async (req, res) => {
    try {
      await db.execute('SELECT 1');
      res.json({ status: 'ok', banco: 'conectado' });
    } catch {
      res.status(500).json({ status: 'erro', banco: 'desconectado' });
    }
  });


  // Loja
  app.use(rotasCatalogo);
  app.use(rotasPedidosLoja);

  // Painel administrativo
  app.use(rotasAuthAdmin);
  app.use(rotasProdutosAdmin);
  app.use(rotasCategoriasAdmin);
  app.use(rotasCampanhasAdmin);
  app.use(rotasPedidosAdmin);
  app.use(rotasEstoqueAdmin);


  app.use(rotaNaoEncontrada);
  app.use(tratarErros);

  return app;
}

module.exports = { criarApp };
