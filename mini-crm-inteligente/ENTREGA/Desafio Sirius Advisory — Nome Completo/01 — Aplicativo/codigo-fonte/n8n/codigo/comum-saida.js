// Trecho compartilhado (copiado pelo gerador para os nós Code). Não é executado sozinho.
const CATEGORIAS = ['Abertura de empresa', 'Consultoria', 'Produtos digitais', 'Outros serviços'];
const PRIORIDADES = ['Alta', 'Média', 'Baixa'];

function validarSaida(obj) {
  const erros = [];
  const dados = obj && typeof obj === 'object' ? obj : {};

  const categoria = CATEGORIAS.find((item) => normalizarTexto(item) === normalizarTexto(dados.categoria));
  if (!categoria) erros.push(`Categoria fora da lista: "${dados.categoria}".`);

  const prioridade = PRIORIDADES.find((item) => normalizarTexto(item) === normalizarTexto(dados.prioridade));
  if (!prioridade) erros.push(`Prioridade fora da lista: "${dados.prioridade}".`);

  const resposta = typeof dados.resposta === 'string' ? dados.resposta.trim() : '';
  if (!resposta || resposta.length > 1000) erros.push('Resposta sugerida ausente ou longa demais.');

  return { erros, valor: { categoria, prioridade, resposta } };
}
