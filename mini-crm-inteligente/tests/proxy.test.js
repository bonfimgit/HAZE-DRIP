// Testes do proxy com um webhook MOCK local que imita o n8n. Nenhuma chamada real ao n8n ou ao Gemini.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { analisarContato } = require('../src/proxy.js');

const ENTRADA = JSON.stringify({ nome: 'Bruno Ferreira', whatsapp: '+55 00 90000-0002', mensagem: 'Já tenho cédula paraguaia e quero contratar.' });
const SAIDA_OK = { categoria: 'Abertura de empresa', prioridade: 'Alta', resposta: 'Olá! Podemos encaminhar?', modo: 'ia' };

function webhookMock(respondedor) {
  const recebidos = [];
  const servidor = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (p) => (corpo += p));
    req.on('end', () => {
      recebidos.push({ metodo: req.method, cabecalhos: req.headers, corpo: JSON.parse(corpo) });
      respondedor(req, res);
    });
  });
  return new Promise((resolve) => {
    servidor.listen(0, '127.0.0.1', () => {
      const { port } = servidor.address();
      resolve({ url: `http://127.0.0.1:${port}/webhook/mini-crm-analise`, recebidos, fechar: () => new Promise((r) => servidor.close(r)) });
    });
  });
}

const opcoes = (url, tempoLimiteMs = 2000) => ({ webhookUrl: url, tempoLimiteMs });

test('MOCK webhook: sucesso encaminha exatamente nome, whatsapp e mensagem e devolve o contrato', async () => {
  const mock = await webhookMock((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(SAIDA_OK));
  });
  try {
    const r = await analisarContato(ENTRADA, opcoes(mock.url));
    assert.equal(r.status, 200);
    assert.deepEqual(r.corpo, SAIDA_OK);
    assert.equal(mock.recebidos.length, 1);
    assert.equal(mock.recebidos[0].metodo, 'POST');
    assert.deepEqual(mock.recebidos[0].corpo, JSON.parse(ENTRADA));
  } finally {
    await mock.fechar();
  }
});

test('MOCK webhook: webhook offline (porta fechada) devolve 503 webhook_offline', async () => {
  const porta = await new Promise((resolve) => {
    const s = http.createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  const r = await analisarContato(ENTRADA, opcoes(`http://127.0.0.1:${porta}/webhook/mini-crm-analise`));
  assert.equal(r.status, 503);
  assert.equal(r.corpo.erro, 'webhook_offline');
  assert.match(r.corpo.mensagem, /workflow está ATIVO/);
});

test('MOCK webhook: demora além do limite devolve 504 timeout', async () => {
  const mock = await webhookMock(() => {
    // não responde: o proxy deve abortar pelo tempo limite
  });
  try {
    const r = await analisarContato(ENTRADA, opcoes(mock.url, 150));
    assert.equal(r.status, 504);
    assert.equal(r.corpo.erro, 'timeout');
  } finally {
    await mock.fechar();
  }
});

test('MOCK webhook: HTTP 500 sem corpo útil devolve 502 http_invalido com status do n8n', async () => {
  const mock = await webhookMock((req, res) => res.writeHead(500, { 'Content-Type': 'text/plain' }).end('Internal'));
  try {
    const r = await analisarContato(ENTRADA, opcoes(mock.url));
    assert.equal(r.status, 502);
    assert.equal(r.corpo.erro, 'http_invalido');
    assert.equal(r.corpo.status_n8n, 500);
  } finally {
    await mock.fechar();
  }
});

test('MOCK webhook: erro estruturado do workflow é repassado com o código de erro', async () => {
  const mock = await webhookMock((req, res) =>
    res.writeHead(502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ erro: 'ia_indisponivel', mensagem: 'O Gemini não respondeu: API key not valid' }))
  );
  try {
    const r = await analisarContato(ENTRADA, opcoes(mock.url));
    assert.equal(r.status, 502);
    assert.equal(r.corpo.erro, 'ia_indisponivel');
    assert.match(r.corpo.mensagem, /API key not valid/);
  } finally {
    await mock.fechar();
  }
});

test('MOCK webhook: JSON malformado no corpo da resposta devolve 502 json_malformado', async () => {
  const mock = await webhookMock((req, res) => res.writeHead(200).end('{"categoria": "Consultoria",'));
  try {
    const r = await analisarContato(ENTRADA, opcoes(mock.url));
    assert.equal(r.status, 502);
    assert.equal(r.corpo.erro, 'json_malformado');
  } finally {
    await mock.fechar();
  }
});

test('MOCK webhook: JSON válido fora do contrato devolve 502 contrato_invalido', async () => {
  const mock = await webhookMock((req, res) =>
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ categoria: 'Imóveis', prioridade: 'Alta', resposta: 'Oi', modo: 'ia' }))
  );
  try {
    const r = await analisarContato(ENTRADA, opcoes(mock.url));
    assert.equal(r.status, 502);
    assert.equal(r.corpo.erro, 'contrato_invalido');
    assert.ok(r.corpo.detalhes.length >= 1);
  } finally {
    await mock.fechar();
  }
});

test('entrada inválida devolve 400 sem chamar o webhook', async () => {
  let chamadas = 0;
  const fetchImpl = async () => { chamadas += 1; };
  const r = await analisarContato(JSON.stringify({ nome: '', whatsapp: '1', mensagem: 'oi' }), { webhookUrl: 'http://x', tempoLimiteMs: 1000, fetchImpl });
  assert.equal(r.status, 400);
  assert.equal(r.corpo.erro, 'entrada_invalida');
  assert.ok(r.corpo.campos.nome);
  assert.equal(chamadas, 0);
});

test('corpo que não é JSON devolve 400 requisicao_invalida', async () => {
  const r = await analisarContato('{quebrado', { webhookUrl: 'http://x', tempoLimiteMs: 1000 });
  assert.equal(r.status, 400);
  assert.equal(r.corpo.erro, 'requisicao_invalida');
});

test('corpo acima do limite devolve 413 corpo_grande', async () => {
  const r = await analisarContato('x'.repeat(9000), { webhookUrl: 'http://x', tempoLimiteMs: 1000 });
  assert.equal(r.status, 413);
});
