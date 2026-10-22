const test = require('node:test');
const assert = require('node:assert/strict');
const CRM = require('../public/js/crm.js');

const AGORA = new Date('2026-10-22T12:00:00.000Z');
const DEPOIS = new Date('2026-10-22T13:00:00.000Z');

function memoria(inicial = {}) {
  const dados = new Map(Object.entries(inicial));
  return {
    getItem: (k) => (dados.has(k) ? dados.get(k) : null),
    setItem: (k, v) => dados.set(k, String(v)),
    dados,
  };
}

function contatoValido(nome, extra = {}) {
  const r = CRM.criarContato({ nome, whatsapp: '+55 00 90000-0002', mensagem: 'Quero saber mais' }, { agora: AGORA, id: nome.toLowerCase() });
  return { ...r.contato, ...extra };
}

test('criarContato cadastra com status Novo e sem análise', () => {
  const r = CRM.criarContato({ nome: 'Bruno Ferreira', whatsapp: '+55 00 90000-0002', mensagem: 'Quero abrir empresa' }, { agora: AGORA, id: 'x1' });
  assert.equal(r.ok, true);
  assert.equal(r.contato.status, 'Novo');
  assert.equal(r.contato.analise, null);
  assert.equal(r.contato.criadoEm, AGORA.toISOString());
});

test('criarContato devolve erros sem criar registro', () => {
  const r = CRM.criarContato({ nome: '', whatsapp: '', mensagem: '' });
  assert.equal(r.ok, false);
  assert.ok(r.erros.nome);
});

test('atualizarStatus muda somente o contato indicado e aceita apenas os três status', () => {
  const lista = [contatoValido('Ana'), contatoValido('Bia')];
  const nova = CRM.atualizarStatus(lista, 'ana', 'Em atendimento', DEPOIS);
  assert.equal(nova.find((c) => c.id === 'ana').status, 'Em atendimento');
  assert.equal(nova.find((c) => c.id === 'bia').status, 'Novo');
  assert.equal(nova.find((c) => c.id === 'ana').atualizadoEm, DEPOIS.toISOString());
  assert.throws(() => CRM.atualizarStatus(lista, 'ana', 'Perdido'), /Status inválido/);
  assert.equal(lista[0].status, 'Novo', 'não deve mutar a lista original');
});

test('registrarAnalise grava categoria, prioridade, resposta e modo', () => {
  const lista = [contatoValido('Ana')];
  const nova = CRM.registrarAnalise(lista, 'ana', { categoria: 'Abertura de empresa', prioridade: 'Alta', resposta: 'Olá!', modo: 'simulacao' }, DEPOIS);
  assert.deepEqual(
    { ...nova[0].analise, analisadoEm: undefined },
    { categoria: 'Abertura de empresa', prioridade: 'Alta', resposta: 'Olá!', modo: 'simulacao', analisadoEm: undefined }
  );
  assert.equal(nova[0].analise.analisadoEm, DEPOIS.toISOString());
});

test('filtrar combina busca sem acento com filtro de status e ordena do mais recente', () => {
  const antigo = contatoValido('Ana Paula', { criadoEm: '2026-10-01T00:00:00.000Z', mensagem: 'Quero abrir EAS' });
  const recente = contatoValido('João Silva', { criadoEm: '2026-10-20T00:00:00.000Z', status: 'Finalizado' });
  const lista = [antigo, recente];
  assert.deepEqual(CRM.filtrar(lista, { termo: 'joao' }).map((c) => c.nome), ['João Silva']);
  assert.deepEqual(CRM.filtrar(lista, { termo: 'eas' }).map((c) => c.nome), ['Ana Paula']);
  assert.deepEqual(CRM.filtrar(lista, { status: 'Finalizado' }).map((c) => c.nome), ['João Silva']);
  assert.deepEqual(CRM.filtrar(lista).map((c) => c.nome), ['João Silva', 'Ana Paula']);
  assert.equal(CRM.filtrar(lista, { termo: 'inexistente' }).length, 0);
});

test('indicadores contam status, análises e prioridade alta', () => {
  const lista = [
    contatoValido('Ana', { status: 'Novo', analise: { prioridade: 'Alta' } }),
    contatoValido('Bia', { status: 'Finalizado', analise: { prioridade: 'Baixa' } }),
    contatoValido('Caio', { status: 'Em atendimento' }),
  ];
  const r = CRM.indicadores(lista);
  assert.equal(r.total, 3);
  assert.deepEqual(r.porStatus, { Novo: 1, 'Em atendimento': 1, Finalizado: 1 });
  assert.equal(r.analisados, 2);
  assert.equal(r.altaPrioridade, 1);
});

test('persistência: salvar e recarregar mantém status e análise', () => {
  const armazenamento = memoria();
  const repo = CRM.criarRepositorio(armazenamento);
  let lista = [contatoValido('Ana')];
  lista = CRM.atualizarStatus(lista, 'ana', 'Em atendimento', DEPOIS);
  lista = CRM.registrarAnalise(lista, 'ana', { categoria: 'Consultoria', prioridade: 'Média', resposta: 'Olá!', modo: 'ia' }, DEPOIS);
  assert.equal(repo.salvar(lista).ok, true);

  const recarregado = CRM.criarRepositorio(armazenamento).carregar();
  assert.equal(recarregado.aviso, null);
  assert.equal(recarregado.contatos[0].status, 'Em atendimento');
  assert.equal(recarregado.contatos[0].analise.prioridade, 'Média');
  assert.equal(recarregado.contatos[0].analise.modo, 'ia');
});

test('persistência: dados corrompidos não quebram a tela e geram aviso', () => {
  const armazenamento = memoria({ [CRM.CHAVE_ARMAZENAMENTO]: '{não é json' });
  const r = CRM.criarRepositorio(armazenamento).carregar();
  assert.deepEqual(r.contatos, []);
  assert.match(r.aviso, /ilegíveis/);
});

test('persistência: lista que não é array é tratada como corrompida', () => {
  const r = CRM.criarRepositorio(memoria({ [CRM.CHAVE_ARMAZENAMENTO]: '{"a":1}' })).carregar();
  assert.deepEqual(r.contatos, []);
  assert.ok(r.aviso);
});

test('persistência: itens inválidos são descartados e status desconhecido vira Novo', () => {
  const bruto = JSON.stringify([{ id: 'ok', nome: 'Ana', status: 'Qualquer' }, { nome: 'sem id' }, null]);
  const r = CRM.criarRepositorio(memoria({ [CRM.CHAVE_ARMAZENAMENTO]: bruto })).carregar();
  assert.equal(r.contatos.length, 1);
  assert.equal(r.contatos[0].status, 'Novo');
});

test('persistência: falha ao gravar devolve aviso em vez de lançar erro', () => {
  const armazenamento = { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); } };
  const r = CRM.criarRepositorio(armazenamento).salvar([]);
  assert.equal(r.ok, false);
  assert.match(r.aviso, /Não foi possível salvar/);
});

test('analisarContato envia exatamente nome, whatsapp e mensagem (MOCK do fetch)', async () => {
  let enviado;
  const fetchMock = async (url, opcoes) => {
    enviado = { url, corpo: JSON.parse(opcoes.body), metodo: opcoes.method };
    return { ok: true, status: 200, json: async () => ({ categoria: 'Consultoria', prioridade: 'Média', resposta: 'Olá!', modo: 'simulacao' }) };
  };
  const r = await CRM.analisarContato({ id: 'x', nome: 'Ana', whatsapp: '+55 00 90000-0002', mensagem: 'Oi tudo bem', status: 'Novo', analise: null }, fetchMock);
  assert.equal(r.ok, true);
  assert.equal(enviado.url, '/api/analisar');
  assert.equal(enviado.metodo, 'POST');
  assert.deepEqual(Object.keys(enviado.corpo).sort(), ['mensagem', 'nome', 'whatsapp']);
});

test('analisarContato traduz erro do servidor para mensagem útil', async () => {
  const fetchMock = async () => ({ ok: false, status: 503, json: async () => ({ erro: 'webhook_offline', mensagem: 'n8n fora do ar' }) });
  const r = await CRM.analisarContato({ nome: 'Ana', whatsapp: '+55 00 90000-0002', mensagem: 'Oi tudo bem' }, fetchMock);
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'webhook_offline');
  assert.equal(r.mensagem, 'n8n fora do ar');
});

test('analisarContato trata falha de rede, tempo esgotado e JSON ilegível', async () => {
  const offline = await CRM.analisarContato({}, async () => { throw new TypeError('fetch failed'); });
  assert.match(offline.mensagem, /Não foi possível falar com o servidor/);

  const tempo = await CRM.analisarContato({}, (url, opcoes) => new Promise((_, rejeitar) => {
    opcoes.signal.addEventListener('abort', () => rejeitar(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }), { tempoLimiteMs: 20 });
  assert.match(tempo.mensagem, /não respondeu a tempo/);

  const ilegivel = await CRM.analisarContato({}, async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } }));
  assert.match(ilegivel.mensagem, /formato inesperado/);
});

test('analisarContato rejeita resposta que não cumpre o contrato', async () => {
  const fetchMock = async () => ({ ok: true, status: 200, json: async () => ({ categoria: 'Imóveis', prioridade: 'Alta', resposta: 'Oi', modo: 'ia' }) });
  const r = await CRM.analisarContato({}, fetchMock);
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'contrato_invalido');
});
