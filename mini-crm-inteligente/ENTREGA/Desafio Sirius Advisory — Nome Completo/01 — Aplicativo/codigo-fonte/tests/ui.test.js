// Testes de navegador (Playwright via playwright-core) contra a interface real.
// Usa o Chromium indicado por CHROME_PATH. Sem navegador disponível, os testes são marcados como "skip".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
let chromium = null;
try {
  ({ chromium } = require('playwright-core'));
} catch (erro) {
  // playwright-core não instalado (ex.: cópia de entrega sem npm install): os testes de navegador são pulados.
}
const { criarServidor } = require('../server.js');

const CAMINHO_CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DISPONIVEL = Boolean(chromium) && fs.existsSync(CAMINHO_CHROME);
const PASTA_CAPTURAS = process.env.CAPTURAS_DIR || null;

// Webhook MOCK: imita a saída da simulação do n8n (modo "simulacao"). Não representa a IA.
function webhookMockSimulacao() {
  const servidor = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ categoria: 'Abertura de empresa', prioridade: 'Alta', resposta: 'Olá! Resposta de teste (MOCK).', modo: 'simulacao' }));
    });
  });
  return new Promise((resolve) => servidor.listen(0, '127.0.0.1', () => resolve(servidor)));
}

function fecharServidor(servidor) {
  return new Promise((resolve) => {
    servidor.close(resolve);
    servidor.closeAllConnections();
  });
}

async function subirApp(webhookUrl) {
  const servidor = criarServidor({ webhookUrl, tempoLimiteMs: 3000 });
  await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${servidor.address().port}`, fechar: () => fecharServidor(servidor) };
}

async function portaFechada() {
  const s = http.createServer().listen(0, '127.0.0.1');
  await new Promise((r) => s.on('listening', r));
  const porta = s.address().port;
  await new Promise((r) => s.close(r));
  return porta;
}

async function novaPagina(navegador, base) {
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
  const pagina = await contexto.newPage();
  pagina.on('pageerror', (erro) => { throw erro; });
  await pagina.goto(base);
  return { pagina, contexto };
}

async function cadastrar(pagina, { nome, whatsapp = '+55 00 90000-0002', mensagem = 'Já tenho cédula paraguaia e quero contratar.' }) {
  await pagina.fill('#campo-nome', nome);
  await pagina.fill('#campo-whatsapp', whatsapp);
  await pagina.fill('#campo-mensagem', mensagem);
  await pagina.click('button[type="submit"]');
}

async function capturar(pagina, nomeArquivo) {
  if (!PASTA_CAPTURAS) return;
  fs.mkdirSync(PASTA_CAPTURAS, { recursive: true });
  await pagina.screenshot({ path: path.join(PASTA_CAPTURAS, nomeArquivo), fullPage: true });
}

const pularSeSemNavegador = { skip: DISPONIVEL ? false : chromium ? `Chromium não encontrado em ${CAMINHO_CHROME} (defina CHROME_PATH)` : 'playwright-core não instalado (rode npm install)' };

test('UI: formulário mostra erros amigáveis e não cadastra sem dados', pularSeSemNavegador, async (t) => {
  const porta = await portaFechada();
  const app = await subirApp(`http://127.0.0.1:${porta}/x`);
  const navegador = await chromium.launch({ executablePath: CAMINHO_CHROME, args: ['--no-sandbox'] });
  try {
    const { pagina, contexto } = await novaPagina(navegador, app.url);
    await pagina.click('button[type="submit"]');
    assert.match(await pagina.textContent('#erro-nome'), /Informe o nome/);
    assert.match(await pagina.textContent('#erro-whatsapp'), /WhatsApp/);
    assert.equal(await pagina.locator('.contato').count(), 0);
    assert.equal(await pagina.isVisible('#estado-vazio'), true);
    await capturar(pagina, 'ui-validacao.png');
    await contexto.close();
  } finally {
    await navegador.close();
    await app.fechar();
  }
});

test('UI: cadastro aparece na lista, status muda e persiste após recarregar', pularSeSemNavegador, async () => {
  const porta = await portaFechada();
  const app = await subirApp(`http://127.0.0.1:${porta}/x`);
  const navegador = await chromium.launch({ executablePath: CAMINHO_CHROME, args: ['--no-sandbox'] });
  try {
    const { pagina, contexto } = await novaPagina(navegador, app.url);
    await cadastrar(pagina, { nome: 'Bruno Ferreira' });
    const cartao = pagina.locator('.contato').first();
    await cartao.waitFor();
    assert.equal(await cartao.locator('.contato-nome').textContent(), 'Bruno Ferreira');
    assert.equal(await cartao.locator('.status-select').inputValue(), 'Novo');

    await cartao.locator('.status-select').selectOption('Em atendimento');
    await pagina.reload();
    await pagina.locator('.contato').first().waitFor();
    assert.equal(await pagina.locator('.status-select').first().inputValue(), 'Em atendimento');
    assert.equal(await pagina.textContent('#ind-atendimento'), '1');

    const salvo = await pagina.evaluate(() => JSON.parse(localStorage.getItem('minicrm.contatos.v1')));
    assert.equal(salvo[0].status, 'Em atendimento');
    await contexto.close();
  } finally {
    await navegador.close();
    await app.fechar();
  }
});

test('UI: n8n offline mostra erro útil no cartão, sem travar o botão', pularSeSemNavegador, async () => {
  const porta = await portaFechada();
  const app = await subirApp(`http://127.0.0.1:${porta}/webhook/mini-crm-analise`);
  const navegador = await chromium.launch({ executablePath: CAMINHO_CHROME, args: ['--no-sandbox'] });
  try {
    const { pagina, contexto } = await novaPagina(navegador, app.url);
    await cadastrar(pagina, { nome: 'Ana Lima' });
    await pagina.locator('.contato').first().waitFor();
    await pagina.click('[data-acao="analisar"]');
    await pagina.waitForFunction(() => document.querySelector('[data-erro-analise]').textContent.length > 0);
    const erro = await pagina.textContent('[data-erro-analise]');
    assert.match(erro, /Não foi possível conectar ao webhook do n8n/);
    assert.equal(await pagina.locator('[data-acao="analisar"]').isDisabled(), false);
    await capturar(pagina, 'ui-n8n-offline.png');
    await contexto.close();
  } finally {
    await navegador.close();
    await app.fechar();
  }
});

test('UI [MOCK webhook de simulação]: resultado mostra categoria, prioridade, resposta e o selo SIMULAÇÃO', pularSeSemNavegador, async (t) => {
  const mock = await webhookMockSimulacao();
  const app = await subirApp(`http://127.0.0.1:${mock.address().port}/webhook/mini-crm-analise`);
  t.after(() => fecharServidor(mock));
  const navegador = await chromium.launch({ executablePath: CAMINHO_CHROME, args: ['--no-sandbox'] });
  try {
    const { pagina, contexto } = await novaPagina(navegador, app.url);
    await cadastrar(pagina, { nome: 'Bruno Ferreira' });
    await pagina.locator('.contato').first().waitFor();
    await pagina.click('[data-acao="analisar"]');
    await pagina.locator('.analise .chip.categoria').waitFor();
    assert.equal(await pagina.textContent('.analise .chip.categoria'), 'Abertura de empresa');
    assert.equal(await pagina.textContent('.analise .chip.prioridade'), 'Prioridade Alta');
    assert.match(await pagina.textContent('.analise .chip.modo'), /SIMULAÇÃO/);
    assert.match(await pagina.textContent('.sugestao p'), /Resposta de teste/);
    assert.equal(await pagina.textContent('#ind-alta'), '1');
    await capturar(pagina, 'ui-analise-simulacao-mock.png');
    await contexto.close();
  } finally {
    await navegador.close();
    await app.fechar();
  }
});

test('UI: texto digitado pelo usuário nunca vira HTML (proteção contra XSS)', pularSeSemNavegador, async () => {
  const porta = await portaFechada();
  const app = await subirApp(`http://127.0.0.1:${porta}/x`);
  const navegador = await chromium.launch({ executablePath: CAMINHO_CHROME, args: ['--no-sandbox'] });
  try {
    const { pagina, contexto } = await novaPagina(navegador, app.url);
    await cadastrar(pagina, { nome: '<img src=x onerror="window.__xss=1">', mensagem: '<b>negrito</b> <script>window.__xss=2</script>' });
    await pagina.locator('.contato').first().waitFor();
    assert.equal(await pagina.evaluate(() => window.__xss), undefined);
    assert.equal(await pagina.locator('.contato img, .contato script, .contato b').count(), 0);
    assert.match(await pagina.textContent('.contato-nome'), /<img src=x/);
    await contexto.close();
  } finally {
    await navegador.close();
    await app.fechar();
  }
});
