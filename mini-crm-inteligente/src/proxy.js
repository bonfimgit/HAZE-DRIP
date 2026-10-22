/*
 * Proxy local: recebe POST /api/analisar do navegador e encaminha ao webhook do n8n.
 * O navegador nunca conhece a URL do n8n nem qualquer chave de IA.
 */
const Contrato = require('../public/js/contrato.js');

const LIMITE_CORPO_BYTES = 8 * 1024;

const MENSAGENS = Object.freeze({
  requisicao_invalida: 'O corpo da requisição não é um JSON válido.',
  entrada_invalida: 'Revise os dados do contato: há campos obrigatórios ou fora do formato.',
  corpo_grande: 'Os dados enviados são grandes demais.',
  webhook_offline:
    'Não foi possível conectar ao webhook do n8n. Confirme se o n8n está em execução e se o workflow está ATIVO (publicado).',
  timeout: 'O n8n demorou demais para responder e a análise foi interrompida. Tente novamente.',
  http_invalido: 'O n8n respondeu com um erro HTTP.',
  json_malformado: 'O n8n respondeu, mas o corpo não é um JSON válido.',
  contrato_invalido: 'O n8n respondeu com JSON fora do formato esperado.',
  ia_indisponivel: 'O workflow de IA não conseguiu consultar o Gemini.',
  resposta_ia_invalida: 'O Gemini respondeu, mas a saída não passou na validação do workflow.',
});

function erro(status, codigo, detalhes = {}) {
  return { status, corpo: { erro: codigo, mensagem: detalhes.mensagem || MENSAGENS[codigo], ...detalhes.extra } };
}

function interpretarErroDeRede(falha) {
  const causa = falha?.cause?.code || falha?.code || '';
  if (falha?.name === 'TimeoutError' || falha?.name === 'AbortError') return erro(504, 'timeout');
  return erro(503, 'webhook_offline', { extra: { detalhe: causa || falha?.message } });
}

/**
 * @param {string} brutoCorpo corpo da requisição do navegador (texto)
 * @param {{ webhookUrl: string, tempoLimiteMs: number, fetchImpl?: Function }} opcoes
 * @returns {Promise<{ status: number, corpo: object }>}
 */
async function analisarContato(brutoCorpo, opcoes) {
  const fetchImpl = opcoes.fetchImpl || fetch;

  if (typeof brutoCorpo === 'string' && Buffer.byteLength(brutoCorpo) > LIMITE_CORPO_BYTES) {
    return erro(413, 'corpo_grande');
  }

  let dados;
  try {
    dados = JSON.parse(brutoCorpo);
  } catch (falha) {
    return erro(400, 'requisicao_invalida');
  }

  const validacao = Contrato.validarEntrada(dados);
  if (!validacao.valido) {
    return erro(400, 'entrada_invalida', { extra: { campos: validacao.erros } });
  }

  let resposta;
  try {
    resposta = await fetchImpl(opcoes.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(validacao.valor),
      signal: AbortSignal.timeout(opcoes.tempoLimiteMs),
    });
  } catch (falha) {
    return interpretarErroDeRede(falha);
  }

  let textoResposta;
  try {
    textoResposta = await resposta.text();
  } catch (falha) {
    return interpretarErroDeRede(falha);
  }

  let corpoN8n;
  let jsonValido = true;
  try {
    corpoN8n = JSON.parse(textoResposta);
  } catch (falha) {
    jsonValido = false;
  }

  if (!resposta.ok) {
    // Erro HTTP tem prioridade sobre o formato do corpo; se o workflow enviou um código conhecido, ele é repassado.
    const codigo = typeof corpoN8n?.erro === 'string' && MENSAGENS[corpoN8n.erro] ? corpoN8n.erro : 'http_invalido';
    const mensagem = typeof corpoN8n?.mensagem === 'string' ? corpoN8n.mensagem : undefined;
    return erro(502, codigo, { mensagem, extra: { status_n8n: resposta.status } });
  }

  if (!jsonValido) {
    return erro(502, 'json_malformado', { extra: { status_n8n: resposta.status } });
  }

  const saida = Contrato.validarSaidaIA(corpoN8n);
  if (!saida.valido) {
    return erro(502, 'contrato_invalido', { extra: { detalhes: saida.erros } });
  }
  return { status: 200, corpo: saida.valor };
}

module.exports = { analisarContato, LIMITE_CORPO_BYTES, MENSAGENS };
