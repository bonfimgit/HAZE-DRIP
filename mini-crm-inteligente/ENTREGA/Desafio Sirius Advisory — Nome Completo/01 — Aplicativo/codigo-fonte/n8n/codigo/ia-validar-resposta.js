// Nó "Validar resposta da IA". Lê a resposta do Gemini, valida o JSON e devolve o contrato.
// Entrada: resposta do nó HTTP Request (ou objeto de erro, com onError "continuar").
const item = $input.first().json;

const falha = (erro, mensagem) => [{ json: { statusCode: 502, corpo: { erro, mensagem } } }];

if (item.error) {
  const detalhe = typeof item.error === 'string' ? item.error : item.error.message || 'erro desconhecido';
  return falha('ia_indisponivel', `O Gemini não respondeu: ${detalhe}`);
}

const texto = (item.candidates?.[0]?.content?.parts || []).map((parte) => parte.text || '').join('').trim();
if (!texto) {
  return falha('resposta_ia_invalida', 'O Gemini não retornou conteúdo (verifique o modelo ou filtros de segurança).');
}

let dados;
try {
  dados = JSON.parse(texto.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
} catch (erroJson) {
  return falha('resposta_ia_invalida', 'O Gemini retornou um texto que não é JSON válido.');
}

const saida = validarSaida(dados);
if (saida.erros.length) return falha('resposta_ia_invalida', saida.erros.join(' '));

return [{ json: { statusCode: 200, corpo: { ...saida.valor, modo: 'ia' } } }];
