const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  prepararAmbiente,
  finalizarAmbiente,
  cadastrarCliente,
  enviadosEmTeste,
  db
} = require('./ajuda');

const emailService = require('../src/services/emailService');

let api;

const enviarOriginal = emailService.enviar;

before(async () => {
  ({ api } = await prepararAmbiente());
});

after(async () => {
  emailService.enviar = enviarOriginal;
  await finalizarAmbiente(api);
});

beforeEach(async () => {
  emailService.enviar = enviarOriginal;
  await db.query('DELETE FROM email_fila');
});


const mensagem = (assunto = 'Teste da fila') => ({
  para: 'fila@teste.com', assunto, html: '<p>Oi</p>', texto: 'Oi'
});

async function itemDaFila(id) {
  const [[item]] = await db.query('SELECT * FROM email_fila WHERE id = ?', [id]);
  return item;
}

// Faz a próxima tentativa "vencer" agora
async function vencer(id) {
  await db.query('UPDATE email_fila SET proxima_tentativa_em = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = ?', [id]);
}


test('e-mail é gravado e enviado na hora', async () => {

  const { id, enviado } = await emailService.enfileirar(mensagem('Envio na hora'));

  assert.equal(enviado, true);
  assert.equal((await itemDaFila(id)).status, 'enviado');
  assert.ok(enviadosEmTeste.some(e => e.assunto === 'Envio na hora'));
});

test('falha no envio não perde o e-mail: nova tentativa depois', async () => {

  emailService.enviar = async () => { throw new Error('Resend fora do ar'); };

  const { id, enviado } = await emailService.enfileirar(mensagem('Depois da falha'));
  assert.equal(enviado, false);

  let item = await itemDaFila(id);
  assert.equal(item.status, 'pendente');
  assert.equal(item.tentativas, 1);
  assert.match(item.ultimo_erro, /Resend fora do ar/);

  // Antes do prazo: não tenta de novo
  emailService.enviar = enviarOriginal;
  assert.equal((await emailService.processarFila()).processados, 0);

  await vencer(id);
  const rodada = await emailService.processarFila();
  assert.deepEqual(rodada, { processados: 1, enviados: 1 });

  item = await itemDaFila(id);
  assert.equal(item.status, 'enviado');
  assert.equal(item.tentativas, 2);
  assert.ok(enviadosEmTeste.some(e => e.assunto === 'Depois da falha'));
});

test('servidor reiniciou: e-mails pendentes ou travados em "enviando" são enviados', async () => {

  // Gravado mas nunca enviado (o processo caiu logo depois do INSERT)
  const [pendente] = await db.query(
    "INSERT INTO email_fila (para, assunto, texto, status) VALUES ('fila@teste.com', 'Pendente antigo', 'x', 'pendente')"
  );

  // Caiu no meio do envio, há 10 minutos
  const [travado] = await db.query(
    `INSERT INTO email_fila (para, assunto, texto, status, travado_em)
     VALUES ('fila@teste.com', 'Travado', 'x', 'enviando', DATE_SUB(NOW(), INTERVAL 10 MINUTE))`
  );

  // Em envio agora por outra rodada: não pode ser pego de novo
  const [emAndamento] = await db.query(
    `INSERT INTO email_fila (para, assunto, texto, status, travado_em)
     VALUES ('fila@teste.com', 'Em andamento', 'x', 'enviando', NOW())`
  );

  const rodada = await emailService.processarFila();
  assert.deepEqual(rodada, { processados: 2, enviados: 2 });

  assert.equal((await itemDaFila(pendente.insertId)).status, 'enviado');
  assert.equal((await itemDaFila(travado.insertId)).status, 'enviado');
  assert.equal((await itemDaFila(emAndamento.insertId)).status, 'enviando');
});

test('duas rodadas ao mesmo tempo não enviam o mesmo e-mail duas vezes', async () => {

  for (let i = 0; i < 5; i++) {
    await db.query(
      "INSERT INTO email_fila (para, assunto, texto, status) VALUES ('fila@teste.com', ?, 'x', 'pendente')",
      [`Paralelo ${i}`]
    );
  }

  const enviados = [];
  emailService.enviar = async msg => {
    enviados.push(msg.assunto);
    await new Promise(resolve => setTimeout(resolve, 20));
    return { id: 'ok' };
  };

  await Promise.all([emailService.processarFila(), emailService.processarFila()]);

  assert.equal(enviados.length, 5);
  assert.equal(new Set(enviados).size, 5);
});

test('depois de várias falhas o e-mail é marcado como "falhou"', async () => {

  emailService.enviar = async () => { throw new Error('Domínio não verificado'); };

  const { id } = await emailService.enfileirar(mensagem('Sem jeito'));

  for (let i = 1; i < emailService.MAX_TENTATIVAS; i++) {
    await vencer(id);
    await emailService.processarFila();
  }

  const item = await itemDaFila(id);
  assert.equal(item.status, 'falhou');
  assert.equal(item.tentativas, emailService.MAX_TENTATIVAS);

  // Não volta a ser tentado
  await vencer(id);
  assert.equal((await emailService.processarFila()).processados, 0);
});

test('e-mails enviados há mais de 30 dias são apagados (dados pessoais)', async () => {

  const { id: antigo } = await emailService.enfileirar(mensagem('Antigo'));
  const { id: recente } = await emailService.enfileirar(mensagem('Recente'));

  await db.query('UPDATE email_fila SET enviado_em = DATE_SUB(NOW(), INTERVAL 31 DAY) WHERE id = ?', [antigo]);

  await emailService.processarFila();

  assert.equal(await itemDaFila(antigo), undefined);
  assert.ok(await itemDaFila(recente));
});

test('excluir a conta apaga os e-mails do cliente guardados na fila', async () => {

  const conta = await cadastrarCliente(api, { email: 'lgpd-fila@teste.com', nome: 'Cliente LGPD' });

  const [[antes]] = await db.query("SELECT COUNT(*) AS total FROM email_fila WHERE para = 'lgpd-fila@teste.com'");
  assert.ok(antes.total >= 1); // e-mail de confirmação do cadastro

  const exclusao = await api.delete('/clientes/me', { token: conta.token, corpo: { senha: conta.senha } });
  assert.equal(exclusao.status, 200, JSON.stringify(exclusao.dados));

  const [[depois]] = await db.query("SELECT COUNT(*) AS total FROM email_fila WHERE para = 'lgpd-fila@teste.com'");
  assert.equal(depois.total, 0);
});
