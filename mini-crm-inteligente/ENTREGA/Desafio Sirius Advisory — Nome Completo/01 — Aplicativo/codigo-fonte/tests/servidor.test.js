// Testes HTTP do servidor real (server.js) em porta efêmera. O webhook aponta para uma porta fechada.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { criarServidor } = require('../server.js');

async function iniciar() {
  const porta = await new Promise((resolve) => {
    const s = http.createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  const servidor = criarServidor({ porta, webhookUrl: `http://127.0.0.1:${porta}/fechado`, tempoLimiteMs: 1000 });
  await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  return { base, fechar: () => new Promise((r) => servidor.close(r)) };
}

test('GET / entrega a interface com lang pt-BR e os scripts do CRM', async () => {
  const app = await iniciar();
  try {
    const r = await fetch(app.base + '/');
    const html = await r.text();
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.match(html, /lang="pt-BR"/);
    assert.match(html, /\/js\/crm\.js/);
    assert.match(html, /id="form-contato"/);
  } finally {
    await app.fechar();
  }
});

test('arquivos estáticos têm tipo correto e caminho fora de public/ é bloqueado', async () => {
  const app = await iniciar();
  try {
    const css = await fetch(app.base + '/css/styles.css');
    assert.match(css.headers.get('content-type'), /text\/css/);
    const fuga = await fetch(app.base + '/..%2fserver.js');
    assert.notEqual(fuga.status, 200);
    const inexistente = await fetch(app.base + '/nao-existe.js');
    assert.equal(inexistente.status, 404);
  } finally {
    await app.fechar();
  }
});

test('POST /api/analisar com webhook offline devolve 503 em JSON', async () => {
  const app = await iniciar();
  try {
    const r = await fetch(app.base + '/api/analisar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome: 'Bruno Ferreira', whatsapp: '+55 00 90000-0002', mensagem: 'Quero contratar o serviço' }),
    });
    const corpo = await r.json();
    assert.equal(r.status, 503);
    assert.equal(corpo.erro, 'webhook_offline');
  } finally {
    await app.fechar();
  }
});

test('GET em /api/analisar devolve 405 e POST com JSON inválido devolve 400', async () => {
  const app = await iniciar();
  try {
    const get = await fetch(app.base + '/api/analisar');
    assert.equal(get.status, 405);
    const ruim = await fetch(app.base + '/api/analisar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(ruim.status, 400);
    assert.equal((await ruim.json()).erro, 'requisicao_invalida');
  } finally {
    await app.fechar();
  }
});

test('GET /api/saude responde ok', async () => {
  const app = await iniciar();
  try {
    const r = await fetch(app.base + '/api/saude');
    assert.deepEqual(await r.json(), { status: 'ok' });
  } finally {
    await app.fechar();
  }
});
