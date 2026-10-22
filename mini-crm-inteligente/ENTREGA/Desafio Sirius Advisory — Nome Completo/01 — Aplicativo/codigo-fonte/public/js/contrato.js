/*
 * Contrato compartilhado entre o navegador, o proxy Node e os testes.
 * Módulo UMD: funciona com <script> no navegador e com require() no Node.
 */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.Contrato = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const CATEGORIAS = Object.freeze(['Abertura de empresa', 'Consultoria', 'Produtos digitais', 'Outros serviços']);
  const PRIORIDADES = Object.freeze(['Alta', 'Média', 'Baixa']);
  const MODOS = Object.freeze(['ia', 'simulacao']);

  function normalizarTexto(valor) {
    return String(valor ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim();
  }

  function validarEntrada(dados) {
    const erros = {};
    const origem = dados && typeof dados === 'object' ? dados : {};
    const nome = typeof origem.nome === 'string' ? origem.nome.trim() : '';
    const whatsapp = typeof origem.whatsapp === 'string' ? origem.whatsapp.trim() : '';
    const mensagem = typeof origem.mensagem === 'string' ? origem.mensagem.trim() : '';

    if (!nome) erros.nome = 'Informe o nome completo do interessado.';
    else if (nome.length < 2 || nome.length > 100) erros.nome = 'O nome deve ter entre 2 e 100 caracteres.';

    const digitos = whatsapp.replace(/\D/g, '');
    if (!whatsapp) erros.whatsapp = 'Informe o WhatsApp com DDD ou código do país.';
    else if (!/^[+\d\s()-]+$/.test(whatsapp) || whatsapp.length > 20 || digitos.length < 10 || digitos.length > 15) {
      erros.whatsapp = 'Use de 10 a 15 dígitos, com espaços, +, - ou parênteses.';
    }

    if (!mensagem) erros.mensagem = 'Escreva a mensagem enviada pelo interessado.';
    else if (mensagem.length < 5 || mensagem.length > 1000) erros.mensagem = 'A mensagem deve ter entre 5 e 1000 caracteres.';

    return {
      valido: Object.keys(erros).length === 0,
      erros,
      valor: { nome, whatsapp, mensagem },
    };
  }

  function validarSaidaIA(dados) {
    const erros = [];
    const origem = dados && typeof dados === 'object' ? dados : {};

    const categoria = CATEGORIAS.find((item) => normalizarTexto(item) === normalizarTexto(origem.categoria));
    if (!categoria) erros.push(`Categoria fora da lista: "${origem.categoria}".`);

    const prioridade = PRIORIDADES.find((item) => normalizarTexto(item) === normalizarTexto(origem.prioridade));
    if (!prioridade) erros.push(`Prioridade fora da lista: "${origem.prioridade}".`);

    const resposta = typeof origem.resposta === 'string' ? origem.resposta.trim() : '';
    if (!resposta || resposta.length > 1000) erros.push('Resposta sugerida ausente ou longa demais.');

    const modo = MODOS.includes(origem.modo) ? origem.modo : null;
    if (!modo) erros.push(`Modo desconhecido: "${origem.modo}".`);

    return {
      valido: erros.length === 0,
      erros,
      valor: { categoria, prioridade, resposta, modo },
    };
  }

  return Object.freeze({
    CATEGORIAS,
    PRIORIDADES,
    MODOS,
    normalizarTexto,
    validarEntrada,
    validarSaidaIA,
  });
});
