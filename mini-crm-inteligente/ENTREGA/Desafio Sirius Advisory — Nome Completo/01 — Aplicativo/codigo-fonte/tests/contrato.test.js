const test = require('node:test');
const assert = require('node:assert/strict');
const Contrato = require('../public/js/contrato.js');

test('validarEntrada aceita os dados fictícios do exemplo do desafio', () => {
  const r = Contrato.validarEntrada({ nome: '  Bruno Ferreira ', whatsapp: '+55 00 90000-0002', mensagem: 'Já tenho cédula paraguaia.' });
  assert.equal(r.valido, true);
  assert.equal(r.valor.nome, 'Bruno Ferreira');
});

test('validarEntrada rejeita campos vazios com mensagens em português', () => {
  const r = Contrato.validarEntrada({ nome: '', whatsapp: '', mensagem: '' });
  assert.equal(r.valido, false);
  assert.deepEqual(Object.keys(r.erros).sort(), ['mensagem', 'nome', 'whatsapp']);
  assert.match(r.erros.nome, /nome completo/);
});

test('validarEntrada limita tamanhos e formato do WhatsApp', () => {
  assert.equal(Contrato.validarEntrada({ nome: 'A', whatsapp: '+55 00 90000-0002', mensagem: 'Olá tudo bem' }).valido, false);
  assert.equal(Contrato.validarEntrada({ nome: 'Ana', whatsapp: '123', mensagem: 'Olá tudo bem' }).valido, false);
  assert.equal(Contrato.validarEntrada({ nome: 'Ana', whatsapp: 'abc 90000 0000', mensagem: 'Olá tudo bem' }).valido, false);
  assert.equal(Contrato.validarEntrada({ nome: 'Ana', whatsapp: '+55 00 90000-0002', mensagem: 'x'.repeat(1001) }).valido, false);
  assert.equal(Contrato.validarEntrada({ nome: 'Ana', whatsapp: '+55 00 90000-0002', mensagem: 'x'.repeat(1000) }).valido, true);
});

test('validarEntrada trata entrada que não é objeto', () => {
  assert.equal(Contrato.validarEntrada(null).valido, false);
  assert.equal(Contrato.validarEntrada('texto').valido, false);
});

test('validarSaidaIA normaliza prioridade sem acento (Media -> Média)', () => {
  const r = Contrato.validarSaidaIA({ categoria: 'consultoria', prioridade: 'Media', resposta: 'Olá!', modo: 'ia' });
  assert.equal(r.valido, true);
  assert.equal(r.valor.prioridade, 'Média');
  assert.equal(r.valor.categoria, 'Consultoria');
});

test('validarSaidaIA recusa categoria, prioridade, modo ou resposta fora do contrato', () => {
  const base = { categoria: 'Consultoria', prioridade: 'Alta', resposta: 'Olá!', modo: 'ia' };
  assert.equal(Contrato.validarSaidaIA({ ...base, categoria: 'Imóveis' }).valido, false);
  assert.equal(Contrato.validarSaidaIA({ ...base, prioridade: 'Urgente' }).valido, false);
  assert.equal(Contrato.validarSaidaIA({ ...base, modo: 'manual' }).valido, false);
  assert.equal(Contrato.validarSaidaIA({ ...base, resposta: '   ' }).valido, false);
  assert.equal(Contrato.validarSaidaIA(null).valido, false);
});

test('validarSaidaIA aceita os dois modos declarados', () => {
  const base = { categoria: 'Consultoria', prioridade: 'Baixa', resposta: 'Olá!' };
  assert.equal(Contrato.validarSaidaIA({ ...base, modo: 'ia' }).valor.modo, 'ia');
  assert.equal(Contrato.validarSaidaIA({ ...base, modo: 'simulacao' }).valor.modo, 'simulacao');
});
