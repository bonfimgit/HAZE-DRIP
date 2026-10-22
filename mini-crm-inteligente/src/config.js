/*
 * Configuração por variáveis de ambiente. Nenhum segredo fica no código.
 */
const DEFAULTS = Object.freeze({
  PORT: 3000,
  N8N_WEBHOOK_URL: 'http://localhost:5678/webhook/mini-crm-analise',
  TEMPO_LIMITE_MS: 30000,
});

function carregarConfig(ambiente = process.env) {
  const porta = Number(ambiente.PORT || DEFAULTS.PORT);
  const tempo = Number(ambiente.TEMPO_LIMITE_MS || DEFAULTS.TEMPO_LIMITE_MS);
  return {
    porta: Number.isInteger(porta) && porta > 0 ? porta : DEFAULTS.PORT,
    webhookUrl: ambiente.N8N_WEBHOOK_URL || DEFAULTS.N8N_WEBHOOK_URL,
    tempoLimiteMs: Number.isInteger(tempo) && tempo > 0 ? tempo : DEFAULTS.TEMPO_LIMITE_MS,
  };
}

module.exports = { carregarConfig, DEFAULTS };
