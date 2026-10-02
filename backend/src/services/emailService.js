/*
  Envio de e-mails transacionais via Resend (https://resend.com).

  Variáveis:
    RESEND_API_KEY   chave da API (sem ela, os e-mails só vão para o log)
    EMAIL_REMETENTE  ex.: "Haze Drip <pedidos@seudominio.com>"
                     (o domínio precisa estar verificado no Resend)
*/

const config = require('../config/ambiente');
const logger = require('../utils/logger');

// Nos testes, os e-mails ficam aqui para conferência
const enviadosEmTeste = [];


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


module.exports = {
  enviar,
  enviadosEmTeste
};
