/*
 * Gera os workflows JSON do n8n a partir dos trechos de código em n8n/codigo/.
 * Uso: node scripts/gerar-workflows.js  (também usado pelos testes para evitar divergências)
 */
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', 'n8n');
const PASTA_CODIGO = path.join(RAIZ, 'codigo');
const URL_GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const CAMINHO_WEBHOOK = 'mini-crm-analise';

const lerCodigo = (arquivo) => fs.readFileSync(path.join(PASTA_CODIGO, arquivo), 'utf8').trim();
const comuns = (...arquivos) => ['comum-entrada.js', ...arquivos].map(lerCodigo);
const montarCodigo = (partes) => partes.join('\n\n');

const posicao = (x, y) => [x, y];

function webhook(id, webhookId) {
  return {
    parameters: { httpMethod: 'POST', path: CAMINHO_WEBHOOK, responseMode: 'responseNode', options: {} },
    id, name: 'Webhook (POST /mini-crm-analise)', type: 'n8n-nodes-base.webhook', typeVersion: 2,
    position: posicao(0, 200), webhookId,
  };
}

function responder(id, nome, x, y) {
  return {
    parameters: {
      respondWith: 'json',
      responseBody: '={{ $json.corpo }}',
      options: { responseCode: '={{ $json.statusCode }}' },
    },
    id, name: nome, type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: posicao(x, y),
  };
}

function codigo(id, nome, arquivoOuCodigo, x, y) {
  return {
    parameters: { jsCode: arquivoOuCodigo },
    id, name: nome, type: 'n8n-nodes-base.code', typeVersion: 2, position: posicao(x, y),
  };
}

function conexoes(mapa) {
  const resultado = {};
  for (const [origem, destinos] of Object.entries(mapa)) {
    resultado[origem] = {
      main: destinos.map((grupo) => grupo.map((nome) => ({ node: nome, type: 'main', index: 0 }))),
    };
  }
  return resultado;
}

function workflowIA() {
  const nomePreparar = 'Validar entrada e preparar prompt';
  const nomeIf = 'Entrada válida?';
  const nomeGemini = 'Gemini: classificar interessado';
  const nomeValidar = 'Validar resposta da IA';
  const nomeResponder = 'Responder ao webhook';
  const nomeWebhook = 'Webhook (POST /mini-crm-analise)';

  return {
    name: 'Mini-CRM · Análise com IA (Gemini)',
    nodes: [
      webhook('a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001'),
      codigo('a1000000-0000-4000-8000-000000000002', nomePreparar, montarCodigo(comuns('comum-saida.js', 'ia-preparar.js')), 240, 200),
      {
        parameters: {
          conditions: {
            options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
            conditions: [{
              id: 'a1000000-0000-4000-8000-000000000010',
              leftValue: '={{ $json.valido }}',
              rightValue: '',
              operator: { type: 'boolean', operation: 'true', singleValue: true },
            }],
            combinator: 'and',
          },
          options: {},
        },
        id: 'a1000000-0000-4000-8000-000000000003', name: nomeIf, type: 'n8n-nodes-base.if', typeVersion: 2.2, position: posicao(480, 200),
      },
      {
        parameters: {
          method: 'POST',
          url: URL_GEMINI,
          authentication: 'genericCredentialType',
          genericAuthType: 'httpHeaderAuth',
          sendBody: true,
          contentType: 'json',
          specifyBody: 'json',
          jsonBody: '={{ JSON.stringify($json.geminiBody) }}',
          options: { timeout: 30000 },
        },
        id: 'a1000000-0000-4000-8000-000000000004',
        name: nomeGemini,
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: posicao(720, 120),
        credentials: { httpHeaderAuth: { id: 'PREENCHER_AO_IMPORTAR', name: 'Gemini API Key (x-goog-api-key)' } },
        onError: 'continueRegularOutput',
      },
      codigo('a1000000-0000-4000-8000-000000000005', nomeValidar, montarCodigo(comuns('comum-saida.js', 'ia-validar-resposta.js')), 960, 120),
      responder('a1000000-0000-4000-8000-000000000006', nomeResponder, 1200, 200),
    ],
    connections: conexoes({
      [nomeWebhook]: [[nomePreparar]],
      [nomePreparar]: [[nomeIf]],
      [nomeIf]: [[nomeGemini], [nomeResponder]],
      [nomeGemini]: [[nomeValidar]],
      [nomeValidar]: [[nomeResponder]],
    }),
    active: false,
    settings: { executionOrder: 'v1' },
    tags: [],
  };
}

function workflowSimulacao() {
  const nomeWebhook = 'Webhook (POST /mini-crm-analise)';
  const nomeRegras = 'Classificar por regras (SEM IA)';
  const nomeResponder = 'Responder ao webhook';
  return {
    name: 'Mini-CRM · Simulação SEM IA (regras no n8n)',
    nodes: [
      webhook('b1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001'),
      codigo('b1000000-0000-4000-8000-000000000002', nomeRegras, montarCodigo(comuns('simulacao.js')), 240, 200),
      responder('b1000000-0000-4000-8000-000000000003', nomeResponder, 480, 200),
    ],
    connections: conexoes({
      [nomeWebhook]: [[nomeRegras]],
      [nomeRegras]: [[nomeResponder]],
    }),
    active: false,
    settings: { executionOrder: 'v1' },
    tags: [],
  };
}

const SAIDAS = {
  'workflow-n8n-ia.json': workflowIA,
  'workflow-n8n-simulacao.json': workflowSimulacao,
};

function gerarTudo() {
  return Object.fromEntries(Object.entries(SAIDAS).map(([arquivo, fabrica]) => [arquivo, fabrica()]));
}

if (require.main === module) {
  for (const [arquivo, workflow] of Object.entries(gerarTudo())) {
    fs.writeFileSync(path.join(RAIZ, arquivo), JSON.stringify(workflow, null, 2) + '\n', 'utf8');
    console.log(`Gerado: n8n/${arquivo}`);
  }
}

module.exports = { gerarTudo, lerCodigo };
