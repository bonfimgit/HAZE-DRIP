// Nó "Classificar por regras (SEM IA)". Não é IA: regras determinísticas executadas dentro do n8n.
// Devolve o mesmo contrato do workflow de IA, com "modo": "simulacao".
const entrada = validarEntrada($input.first().json.body);
if (!entrada.valido) {
  return [{ json: { statusCode: 400, corpo: { erro: 'entrada_invalida', mensagem: 'Revise os dados do contato.', campos: entrada.erros } } }];
}

const { nome, mensagem } = entrada.valor;
const texto = normalizarTexto(mensagem);
const primeiroNome = nome.split(' ')[0];

const palavrasUteis = texto.match(/[a-z]{3,}/g) || [];
const DUVIDA = /\bnao sei\b|\bduvida|\bdiferenca\b|\bmelhor\b|\bcomo funciona\b|\bqual\b|\bou\b|\?/;
// Cláusulas negadas ("não quero abrir empresa") não podem contar como intenção de contratar.
const textoAfirmativo = texto.replace(/\bnao quero\b[^.!?]*/g, ' ');
const INTENCAO = /\bcontrat|\bfechar\b|\btenho cedula\b|\bquero (abrir|montar|iniciar|comecar|contratar)\b|\bquanto custa\b|\bvalor\b|\bpreco\b|\borcamento\b/;
const PESQUISA = /\bainda nao\b|\baprender\b|\bpesquis|\bcuriosidade\b|\bconhecer\b|\bmais sobre\b|\bsaber mais\b/;
const ABERTURA = /\babert|\bempresa\b|\bcedula\b|\beas\b|\bunipessoal\b|\bunipersonal\b|\bsociedade\b/;
const DIGITAL = /\bcurso\b|\bebook\b|\bproduto digital\b|\bsite\b|\bapp\b|\bmodelo\b/;

function classificar() {
  if (palavrasUteis.length < 3) {
    return {
      categoria: 'Outros serviços',
      prioridade: 'Baixa',
      resposta: `Olá, ${primeiroNome}! Para entender melhor sua necessidade, pode nos contar qual tipo de apoio você procura: abertura de empresa, consultoria ou outro serviço?`,
    };
  }
  if (DUVIDA.test(texto)) {
    return {
      categoria: 'Consultoria',
      prioridade: 'Média',
      resposta: `Olá, ${primeiroNome}! Essa é uma decisão que depende de cada caso. Podemos agendar uma conversa com nossa equipe para comparar as opções? Antes, você já possui cédula paraguaia?`,
    };
  }
  if (INTENCAO.test(textoAfirmativo)) {
    let categoria = 'Consultoria';
    if (ABERTURA.test(texto)) categoria = 'Abertura de empresa';
    else if (DIGITAL.test(texto)) categoria = 'Produtos digitais';
    return {
      categoria,
      prioridade: 'Alta',
      resposta: `Olá, ${primeiroNome}! Obrigado pelo contato. Podemos encaminhar seu interesse para a equipe comercial e apresentar os próximos passos?`,
    };
  }
  if (PESQUISA.test(texto)) {
    return {
      categoria: 'Produtos digitais',
      prioridade: 'Baixa',
      resposta: `Olá, ${primeiroNome}! Que bom saber do seu interesse. Temos conteúdos educativos sobre negócios no Paraguai e podemos indicar o material mais adequado quando você quiser.`,
    };
  }
  return {
    categoria: 'Outros serviços',
    prioridade: 'Baixa',
    resposta: `Olá, ${primeiroNome}! Obrigado pelo contato. Pode nos dar mais detalhes sobre o que procura para encaminharmos a melhor orientação?`,
  };
}

const { categoria, prioridade, resposta } = classificar();
return [{ json: { statusCode: 200, corpo: { categoria, prioridade, resposta, modo: 'simulacao' } } }];
