/*
 * Regras do CRM: criação, status, análise, filtros, indicadores e persistência.
 * Não manipula o DOM; recebe o armazenamento e o fetch por parâmetro para ser testável.
 */
(function (raiz, fabrica) {
  const api = fabrica(typeof module === 'object' && module.exports ? require('./contrato.js') : raiz.Contrato);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.CRM = api;
})(typeof self !== 'undefined' ? self : globalThis, function (Contrato) {
  'use strict';

  const STATUS = Object.freeze(['Novo', 'Em atendimento', 'Finalizado']);
  const CHAVE_ARMAZENAMENTO = 'minicrm.contatos.v1';
  const TEMPO_LIMITE_CLIENTE_MS = 40000;

  const MENSAGENS_CLIENTE = Object.freeze({
    servidor_indisponivel: 'Não foi possível falar com o servidor do CRM. Confirme se o comando "npm start" está em execução.',
    tempo_esgotado: 'O servidor não respondeu a tempo. Tente novamente em instantes.',
    resposta_ilegivel: 'O servidor respondeu em um formato inesperado.',
  });

  function gerarId() {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function criarContato(dados, { agora = new Date(), id = gerarId() } = {}) {
    const validacao = Contrato.validarEntrada(dados);
    if (!validacao.valido) return { ok: false, erros: validacao.erros };
    const momento = agora.toISOString();
    return {
      ok: true,
      contato: { id, ...validacao.valor, status: 'Novo', criadoEm: momento, atualizadoEm: momento, analise: null },
    };
  }

  function atualizarStatus(contatos, id, status, agora = new Date()) {
    if (!STATUS.includes(status)) throw new Error(`Status inválido: ${status}`);
    return contatos.map((contato) =>
      contato.id === id ? { ...contato, status, atualizadoEm: agora.toISOString() } : contato
    );
  }

  function registrarAnalise(contatos, id, saida, agora = new Date()) {
    const momento = agora.toISOString();
    const { categoria, prioridade, resposta, modo } = saida;
    return contatos.map((contato) =>
      contato.id === id
        ? { ...contato, analise: { categoria, prioridade, resposta, modo, analisadoEm: momento }, atualizadoEm: momento }
        : contato
    );
  }

  function filtrar(contatos, { termo = '', status = '' } = {}) {
    const busca = Contrato.normalizarTexto(termo);
    return contatos
      .filter((contato) => !status || contato.status === status)
      .filter((contato) => {
        if (!busca) return true;
        const texto = Contrato.normalizarTexto(`${contato.nome} ${contato.whatsapp} ${contato.mensagem}`);
        return texto.includes(busca);
      })
      .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
  }

  function indicadores(contatos) {
    const porStatus = Object.fromEntries(STATUS.map((item) => [item, 0]));
    let analisados = 0;
    let altaPrioridade = 0;
    contatos.forEach((contato) => {
      porStatus[contato.status] = (porStatus[contato.status] || 0) + 1;
      if (contato.analise) analisados += 1;
      if (contato.analise?.prioridade === 'Alta') altaPrioridade += 1;
    });
    return { total: contatos.length, porStatus, analisados, altaPrioridade };
  }

  function sanitizarContato(item) {
    if (!item || typeof item !== 'object') return null;
    if (typeof item.id !== 'string' || typeof item.nome !== 'string') return null;
    return {
      ...item,
      status: STATUS.includes(item.status) ? item.status : 'Novo',
      analise: item.analise && typeof item.analise === 'object' ? item.analise : null,
    };
  }

  function criarRepositorio(armazenamento, chave = CHAVE_ARMAZENAMENTO) {
    return {
      carregar() {
        try {
          const bruto = armazenamento.getItem(chave);
          if (!bruto) return { contatos: [], aviso: null };
          const lista = JSON.parse(bruto);
          if (!Array.isArray(lista)) throw new Error('formato inesperado');
          return { contatos: lista.map(sanitizarContato).filter(Boolean), aviso: null };
        } catch (erro) {
          return {
            contatos: [],
            aviso: 'Os dados salvos neste navegador estão ilegíveis, por isso a lista começou vazia. Os dados antigos não foram apagados do navegador.',
          };
        }
      },
      salvar(contatos) {
        try {
          armazenamento.setItem(chave, JSON.stringify(contatos));
          return { ok: true, aviso: null };
        } catch (erro) {
          return { ok: false, aviso: 'Não foi possível salvar no navegador (armazenamento cheio ou bloqueado).' };
        }
      },
    };
  }

  async function analisarContato(dados, fetchImpl, { tempoLimiteMs = TEMPO_LIMITE_CLIENTE_MS } = {}) {
    const controlador = typeof AbortController === 'function' ? new AbortController() : null;
    const temporizador = controlador ? setTimeout(() => controlador.abort(), tempoLimiteMs) : null;
    const entrada = { nome: dados.nome, whatsapp: dados.whatsapp, mensagem: dados.mensagem };

    try {
      let resposta;
      try {
        resposta = await fetchImpl('/api/analisar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entrada),
          signal: controlador?.signal,
        });
      } catch (erro) {
        const tempo = erro?.name === 'AbortError';
        return { ok: false, mensagem: MENSAGENS_CLIENTE[tempo ? 'tempo_esgotado' : 'servidor_indisponivel'] };
      }

      let corpo;
      try {
        corpo = await resposta.json();
      } catch (erro) {
        return { ok: false, mensagem: MENSAGENS_CLIENTE.resposta_ilegivel };
      }

      if (!resposta.ok) {
        return { ok: false, codigo: corpo?.erro, mensagem: corpo?.mensagem || `Erro HTTP ${resposta.status}.` };
      }

      const validacao = Contrato.validarSaidaIA(corpo);
      if (!validacao.valido) {
        return { ok: false, codigo: 'contrato_invalido', mensagem: validacao.erros.join(' ') };
      }
      return { ok: true, saida: validacao.valor };
    } finally {
      if (temporizador) clearTimeout(temporizador);
    }
  }

  return Object.freeze({
    STATUS,
    CHAVE_ARMAZENAMENTO,
    criarContato,
    atualizarStatus,
    registrarAnalise,
    filtrar,
    indicadores,
    criarRepositorio,
    analisarContato,
  });
});
