/*
  Validação centralizada.
  Cada função devolve o valor normalizado ou lança ErroApp 400
  com a mensagem informada.
*/

const { requisicaoInvalida } = require('./erros');

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


// Converte true, 1, '1', 'true' em boolean
function paraBoolean(valor) {
  return (
    valor === true ||
    valor === 1 ||
    valor === '1' ||
    String(valor).toLowerCase() === 'true'
  );
}


function id(valor, mensagem = 'ID inválido') {

  const numero = Number(valor);

  if (!Number.isInteger(numero) || numero <= 0) {
    throw requisicaoInvalida(mensagem);
  }

  return numero;
}


/*
  Texto com tamanho máximo.
  Opcional: devolve null quando vazio.
*/
function texto(valor, mensagem, { max = 255, opcional = false, min = 0 } = {}) {

  if (valor == null || valor === '') {
    if (opcional) {
      return null;
    }
    throw requisicaoInvalida(mensagem);
  }

  if (typeof valor !== 'string') {
    throw requisicaoInvalida(mensagem);
  }

  const resultado = valor.trim();

  if (!resultado) {
    if (opcional) {
      return null;
    }
    throw requisicaoInvalida(mensagem);
  }

  if (resultado.length > max || resultado.length < min) {
    throw requisicaoInvalida(mensagem);
  }

  return resultado;
}


function email(valor, mensagem = 'E-mail inválido') {

  const resultado = texto(valor, mensagem, { max: 150 });

  if (!REGEX_EMAIL.test(resultado)) {
    throw requisicaoInvalida(mensagem);
  }

  return resultado.toLowerCase();
}


function inteiro(valor, mensagem, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {

  if (valor == null || valor === '') {
    throw requisicaoInvalida(mensagem);
  }

  const numero = Number(valor);

  if (!Number.isInteger(numero) || numero < min || numero > max) {
    throw requisicaoInvalida(mensagem);
  }

  return numero;
}


function dinheiro(valor, mensagem, { min = 0.01, max = 1000000 } = {}) {

  if (valor == null || valor === '') {
    throw requisicaoInvalida(mensagem);
  }

  const numero = Number(valor);

  if (!Number.isFinite(numero) || numero < min || numero > max) {
    throw requisicaoInvalida(mensagem);
  }

  return Math.round(numero * 100) / 100;
}


function obrigatorio(valor, mensagem) {

  if (valor == null) {
    throw requisicaoInvalida(mensagem);
  }

  return valor;
}


function umDe(valor, opcoes, mensagem) {

  if (!opcoes.includes(valor)) {
    throw requisicaoInvalida(mensagem);
  }

  return valor;
}


function cep(valor, mensagem = 'CEP inválido') {

  const digitos = texto(valor, mensagem, { max: 9 }).replace(/\D/g, '');

  if (digitos.length !== 8) {
    throw requisicaoInvalida(mensagem);
  }

  return `${digitos.slice(0, 5)}-${digitos.slice(5)}`;
}


function telefone(valor, mensagem = 'Telefone inválido') {

  const resultado = texto(valor, mensagem, { max: 20 });
  const digitos = resultado.replace(/\D/g, '');

  if (digitos.length < 10 || digitos.length > 11) {
    throw requisicaoInvalida(mensagem);
  }

  return resultado;
}


function uf(valor, mensagem = 'Estado inválido') {

  const resultado = texto(valor, mensagem, { max: 2 });

  if (!/^[A-Za-z]{2}$/.test(resultado)) {
    throw requisicaoInvalida(mensagem);
  }

  return resultado.toUpperCase();
}


/*
  Senha: mínimo de 8 caracteres, com letra e número.
*/
function senha(valor, mensagem = 'A senha deve ter pelo menos 8 caracteres, com letras e números') {

  if (
    typeof valor !== 'string' ||
    valor.length < 8 ||
    valor.length > 128 ||
    !/[A-Za-z]/.test(valor) ||
    !/\d/.test(valor)
  ) {
    throw requisicaoInvalida(mensagem);
  }

  return valor;
}


// Data no formato AAAA-MM-DD ou ISO; opcional devolve null
function data(valor, mensagem, { opcional = false } = {}) {

  if (valor == null || valor === '') {
    if (opcional) {
      return null;
    }
    throw requisicaoInvalida(mensagem);
  }

  const resultado = new Date(valor);

  if (typeof valor !== 'string' || Number.isNaN(resultado.getTime())) {
    throw requisicaoInvalida(mensagem);
  }

  return resultado;
}


module.exports = {
  paraBoolean,
  id,
  texto,
  email,
  inteiro,
  dinheiro,
  obrigatorio,
  umDe,
  cep,
  telefone,
  uf,
  senha,
  data
};
