/*
  Envio de e-mails transacionais via Resend (https://resend.com).

  Variáveis:
    RESEND_API_KEY   chave da API (sem ela, os e-mails só vão para o log)
    EMAIL_REMETENTE  ex.: "Haze Drip <pedidos@seudominio.com>"
                     (o domínio precisa estar verificado no Resend)
*/

const crypto = require('crypto');

const config = require('../config/ambiente');
const db = require('../config/db');
const logger = require('../utils/logger');

// Nos testes, os e-mails ficam aqui para conferência
const enviadosEmTeste = [];

const MAX_TENTATIVAS = 8;
const LOTE_MAXIMO = 20;

// "enviando" há mais tempo que isso: o servidor caiu no meio do envio
const MINUTOS_TRAVA = 5;

// E-mails enviados guardam dados pessoais: apagados depois deste prazo
const DIAS_HISTORICO = 30;


/*
  Envio direto pela API do Resend (uma tentativa).
  O restante do sistema usa enfileirar(), que grava antes de enviar.
*/
async function enviar({ para, assunto, html, texto }) {

  const apiKey = process.env.RESEND_API_KEY;
  const remetente = process.env.EMAIL_REMETENTE || 'Haze Drip <onboarding@resend.dev>';

  if (config.emTeste) {
    enviadosEmTeste.push({ para, assunto, html, texto });
    return { simulado: true };
  }

  if (!apiKey) {
    logger.aviso('E-mail não enviado (RESEND_API_KEY ausente)', { para, assunto });
    return { simulado: true };
  }

  const resposta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: remetente,
      to: [para],
      subject: assunto,
      html,
      text: texto
    }),
    signal: AbortSignal.timeout(10000)
  });

  if (!resposta.ok) {
    const corpo = await resposta.text();
    throw new Error(`Resend respondeu ${resposta.status}: ${corpo.slice(0, 300)}`);
  }

  const dados = await resposta.json();

  logger.info('E-mail enviado', { para, assunto, id: dados.id });

  return dados;
}


/* =============================================================
   FILA
============================================================= */

// 1, 2, 4, 8... minutos até a próxima tentativa (máximo 6 horas)
function minutosAteProximaTentativa(tentativas) {
  return Math.min(2 ** (tentativas - 1), 6 * 60);
}


async function enviarItem(item) {

  try {

    // Via o objeto exportado: os testes podem simular falhas do Resend
    const resultado = await emailService.enviar({
      para: item.para,
      assunto: item.assunto,
      html: item.html,
      texto: item.texto
    });

    await db.execute(
      `UPDATE email_fila
       SET status = 'enviado', enviado_em = NOW(), tentativas = tentativas + 1,
           provedor_id = ?, ultimo_erro = ?, lote = NULL, travado_em = NULL
       WHERE id = ?`,
      [
        resultado?.id ? String(resultado.id).slice(0, 100) : null,
        resultado?.simulado ? 'Não enviado: RESEND_API_KEY ausente' : null,
        item.id
      ]
    );

    return true;

  } catch (erro) {

    const tentativas = Number(item.tentativas) + 1;
    const desistir = tentativas >= MAX_TENTATIVAS;

    await db.execute(
      `UPDATE email_fila
       SET status = ?, tentativas = ?, ultimo_erro = ?,
           proxima_tentativa_em = DATE_ADD(NOW(), INTERVAL ? MINUTE),
           lote = NULL, travado_em = NULL
       WHERE id = ?`,
      [
        desistir ? 'falhou' : 'pendente',
        tentativas,
        String(erro.message).slice(0, 500),
        minutosAteProximaTentativa(tentativas),
        item.id
      ]
    );

    (desistir ? logger.erro : logger.aviso)(
      desistir ? 'E-mail descartado após várias tentativas' : 'Falha ao enviar e-mail; nova tentativa agendada',
      { emailId: item.id, para: item.para, assunto: item.assunto, tentativas, erro: erro.message }
    );

    return false;
  }
}


/*
  Grava o e-mail na fila e já tenta enviar (mesma rapidez de antes).
  Falha de envio não lança erro: a fila tenta de novo depois.
  Só lança se não conseguir gravar no banco.
*/
async function enfileirar({ para, assunto, html, texto }) {

  const [resultado] = await db.execute(
    `INSERT INTO email_fila (para, assunto, html, texto, status, travado_em)
     VALUES (?, ?, ?, ?, 'enviando', NOW())`,
    [para, String(assunto).slice(0, 255), html ?? null, texto ?? null]
  );

  const item = { id: resultado.insertId, para, assunto, html, texto, tentativas: 0 };

  return { id: item.id, enviado: await enviarItem(item) };
}


/*
  Envia o que ficou para trás: falhas com nova tentativa vencida e
  e-mails que travaram em "enviando" (servidor reiniciou no meio).
  Chamado periodicamente pelo server.js.

  Cada rodada reserva um lote com um identificador próprio, então
  duas rodadas ao mesmo tempo não enviam o mesmo e-mail.
*/
async function processarFila() {

  const lote = crypto.randomUUID();

  await db.query(
    `UPDATE email_fila
     SET status = 'enviando', lote = ?, travado_em = NOW()
     WHERE (status = 'pendente' AND proxima_tentativa_em <= NOW())
        OR (status = 'enviando' AND travado_em < DATE_SUB(NOW(), INTERVAL ? MINUTE))
     ORDER BY id
     LIMIT ?`,
    [lote, MINUTOS_TRAVA, LOTE_MAXIMO]
  );

  const [itens] = await db.query(
    'SELECT * FROM email_fila WHERE lote = ? ORDER BY id',
    [lote]
  );

  let enviados = 0;

  for (const item of itens) {
    if (await enviarItem(item)) {
      enviados++;
    }
  }

  await db.query(
    `DELETE FROM email_fila
     WHERE status = 'enviado'
     AND enviado_em < DATE_SUB(NOW(), INTERVAL ? DAY)
     LIMIT 500`,
    [DIAS_HISTORICO]
  );

  return { processados: itens.length, enviados };
}


// LGPD: exclusão da conta remove os e-mails guardados para o endereço
async function removerDoDestinatario(para) {
  await db.execute('DELETE FROM email_fila WHERE para = ?', [para]);
}


const emailService = {
  enviar,
  enfileirar,
  processarFila,
  removerDoDestinatario,
  enviadosEmTeste,
  MAX_TENTATIVAS
};

module.exports = emailService;
