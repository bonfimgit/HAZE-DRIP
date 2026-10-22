// Os três testes obrigatórios do desafio.
// - Os cenários com "[regras n8n]" executam o nó de regras REAL do workflow de simulação (sem IA).
// - Os cenários com "[MOCK Gemini]" validam a saída esperada da IA por meio de uma resposta simulada; não é prova de execução do modelo.
const test = require('node:test');
const assert = require('node:assert/strict');
const { executarCodigo, codigoDe, simulacao, ia } = require('./n8n.test.js');

const CASOS = [
  {
    nome: 'Teste 1 — Dúvidas',
    mensagem: 'Quero abrir uma empresa no Paraguai, mas não sei se é melhor EAS ou Unipersonal. Ainda não tenho cédula.',
    esperado: { prioridade: 'Média', categoria: 'Consultoria' },
    criterio: 'consultoria ou pergunta complementar, sem orientação jurídica definitiva',
  },
  {
    nome: 'Teste 2 — Pronto para contratar',
    mensagem: 'Já tenho cédula paraguaia e quero contratar o serviço de abertura de EAS.',
    esperado: { prioridade: 'Alta', categoria: 'Abertura de empresa' },
    criterio: 'prioridade Alta e encaminhamento comercial',
  },
  {
    nome: 'Teste 3 — Pesquisando',
    mensagem: 'Ainda não quero abrir empresa. Gostaria de aprender mais sobre negócios no Paraguai.',
    esperado: { prioridade: 'Baixa', categoria: 'Produtos digitais' },
    criterio: 'prioridade Baixa e conteúdo educativo/produto digital',
  },
];

const DADOS = { nome: 'Bruno Ferreira', whatsapp: '+55 00 90000-0002' };

for (const caso of CASOS) {
  test(`[regras n8n] ${caso.nome}: ${caso.criterio}`, () => {
    const codigo = codigoDe(simulacao, 'Classificar por regras (SEM IA)');
    const [item] = executarCodigo(codigo, { body: { ...DADOS, mensagem: caso.mensagem } });
    assert.equal(item.json.statusCode, 200);
    assert.equal(item.json.corpo.modo, 'simulacao');
    assert.equal(item.json.corpo.prioridade, caso.esperado.prioridade);
    assert.equal(item.json.corpo.categoria, caso.esperado.categoria);
    assert.ok(item.json.corpo.resposta.length > 20);
  });

  test(`[MOCK Gemini] ${caso.nome}: a validação aceita a saída esperada da IA`, () => {
    const codigo = codigoDe(ia, 'Validar resposta da IA');
    const mock = { candidates: [{ content: { parts: [{ text: JSON.stringify({ categoria: caso.esperado.categoria, prioridade: caso.esperado.prioridade, resposta: 'Resposta sugerida (MOCK).' }) }] } }] };
    const [item] = executarCodigo(codigo, mock);
    assert.equal(item.json.statusCode, 200);
    assert.equal(item.json.corpo.modo, 'ia');
    assert.equal(item.json.corpo.prioridade, caso.esperado.prioridade);
  });
}

test('[regras n8n] "Ainda não quero abrir empresa" não é tratado como intenção de contratar', () => {
  const codigo = codigoDe(simulacao, 'Classificar por regras (SEM IA)');
  const [item] = executarCodigo(codigo, { body: { ...DADOS, mensagem: 'Ainda não quero abrir empresa agora.' } });
  assert.notEqual(item.json.corpo.prioridade, 'Alta');
});

test('[regras n8n] mensagem sem contexto gera pergunta complementar, não classificação inventada', () => {
  const codigo = codigoDe(simulacao, 'Classificar por regras (SEM IA)');
  const [item] = executarCodigo(codigo, { body: { ...DADOS, mensagem: 'Oi, tudo bem?' } });
  assert.equal(item.json.corpo.categoria, 'Outros serviços');
  assert.match(item.json.corpo.resposta, /\?$/);
});
