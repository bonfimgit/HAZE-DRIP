// Trecho compartilhado (copiado pelo gerador para os nós Code). Não é executado sozinho.
function normalizarTexto(valor) {
  return String(valor ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function validarEntrada(corpo) {
  const erros = {};
  const dados = corpo && typeof corpo === 'object' ? corpo : {};
  const nome = typeof dados.nome === 'string' ? dados.nome.trim() : '';
  const whatsapp = typeof dados.whatsapp === 'string' ? dados.whatsapp.trim() : '';
  const mensagem = typeof dados.mensagem === 'string' ? dados.mensagem.trim() : '';

  if (nome.length < 2 || nome.length > 100) erros.nome = 'O nome deve ter entre 2 e 100 caracteres.';
  const digitos = whatsapp.replace(/\D/g, '');
  if (!/^[+\d\s()-]+$/.test(whatsapp) || whatsapp.length > 20 || digitos.length < 10 || digitos.length > 15) {
    erros.whatsapp = 'Use de 10 a 15 dígitos, com espaços, +, - ou parênteses.';
  }
  if (mensagem.length < 5 || mensagem.length > 1000) erros.mensagem = 'A mensagem deve ter entre 5 e 1000 caracteres.';

  return { valido: Object.keys(erros).length === 0, erros, valor: { nome, whatsapp, mensagem } };
}
