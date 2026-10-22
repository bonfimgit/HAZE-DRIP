/*
 * Servidor do Mini-CRM: serve a interface estática e a rota POST /api/analisar.
 * Uso: npm start   (variáveis opcionais: PORT, N8N_WEBHOOK_URL, TEMPO_LIMITE_MS)
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { carregarConfig } = require('./src/config');
const { analisarContato, LIMITE_CORPO_BYTES } = require('./src/proxy');

const PASTA_PUBLICA = path.join(__dirname, 'public');
const TIPOS = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
});

function enviarJson(res, status, corpo) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(corpo));
}

function lerCorpo(req, limite) {
  return new Promise((resolve, reject) => {
    const pedacos = [];
    let tamanho = 0;
    req.on('data', (pedaco) => {
      tamanho += pedaco.length;
      if (tamanho > limite) {
        reject(Object.assign(new Error('corpo grande'), { codigo: 'corpo_grande' }));
        req.destroy();
        return;
      }
      pedacos.push(pedaco);
    });
    req.on('end', () => resolve(Buffer.concat(pedacos).toString('utf8')));
    req.on('error', reject);
  });
}

function servirArquivo(req, res, caminhoUrl) {
  const relativo = caminhoUrl === '/' ? 'index.html' : decodeURIComponent(caminhoUrl.slice(1));
  const absoluto = path.normalize(path.join(PASTA_PUBLICA, relativo));
  if (!absoluto.startsWith(PASTA_PUBLICA + path.sep)) {
    res.writeHead(403).end('Acesso negado');
    return;
  }
  fs.readFile(absoluto, (erro, conteudo) => {
    if (erro) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Não encontrado');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TIPOS[path.extname(absoluto)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : conteudo);
  });
}

function criarServidor(config = carregarConfig()) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/api/saude' && req.method === 'GET') {
      return enviarJson(res, 200, { status: 'ok' });
    }

    if (url.pathname === '/api/analisar') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return enviarJson(res, 405, { erro: 'metodo_nao_permitido', mensagem: 'Use POST nesta rota.' });
      }
      try {
        const corpo = await lerCorpo(req, LIMITE_CORPO_BYTES);
        const resultado = await analisarContato(corpo, config);
        return enviarJson(res, resultado.status, resultado.corpo);
      } catch (falha) {
        if (falha.codigo === 'corpo_grande') {
          return enviarJson(res, 413, { erro: 'corpo_grande', mensagem: 'Os dados enviados são grandes demais.' });
        }
        return enviarJson(res, 500, { erro: 'erro_interno', mensagem: 'Erro interno no servidor do CRM.' });
      }
    }

    if (req.method === 'GET' || req.method === 'HEAD') return servirArquivo(req, res, url.pathname);
    res.writeHead(405).end();
  });
}

if (require.main === module) {
  const config = carregarConfig();
  criarServidor(config).listen(config.porta, () => {
    console.log(`Mini-CRM em http://localhost:${config.porta}`);
    console.log(`Webhook n8n: ${config.webhookUrl}`);
  });
}

module.exports = { criarServidor };
