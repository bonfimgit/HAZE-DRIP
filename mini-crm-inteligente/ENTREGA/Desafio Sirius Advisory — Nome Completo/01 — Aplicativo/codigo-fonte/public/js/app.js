/*
 * Camada de interface: liga o DOM às regras de crm.js.
 * Todo texto de usuário entra por textContent; nunca por innerHTML.
 */
(function () {
  'use strict';

  const CRM = window.CRM;
  const repositorio = CRM.criarRepositorio(window.localStorage);

  const el = (id) => document.getElementById(id);
  const formulario = el('form-contato');
  const lista = el('lista');
  const campos = { nome: el('campo-nome'), whatsapp: el('campo-whatsapp'), mensagem: el('campo-mensagem') };
  const erros = { nome: el('erro-nome'), whatsapp: el('erro-whatsapp'), mensagem: el('erro-mensagem') };

  const estado = {
    contatos: [],
    emAnalise: new Set(),
    filtro: { termo: '', status: '' },
  };

  function criarElemento(tag, classe, texto) {
    const nodo = document.createElement(tag);
    if (classe) nodo.className = classe;
    if (texto !== undefined) nodo.textContent = texto;
    return nodo;
  }

  function formatarData(iso) {
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }

  function persistir() {
    const resultado = repositorio.salvar(estado.contatos);
    mostrarAvisoArmazenamento(resultado.aviso);
  }

  function mostrarAvisoArmazenamento(texto) {
    const aviso = el('aviso-armazenamento');
    aviso.hidden = !texto;
    aviso.textContent = texto || '';
  }

  function mostrarAvisoFormulario(texto, tipo) {
    const aviso = el('aviso-form');
    aviso.textContent = texto;
    aviso.className = `aviso ${tipo || ''}`.trim();
  }

  function limparErros() {
    Object.values(erros).forEach((nodo) => (nodo.textContent = ''));
    Object.values(campos).forEach((campo) => campo.removeAttribute('aria-invalid'));
  }

  function atualizarContador() {
    const tamanho = campos.mensagem.value.length;
    el('contador-mensagem').textContent = `${tamanho}/1000`;
  }

  function renderizarIndicadores() {
    const dados = CRM.indicadores(estado.contatos);
    el('ind-total').textContent = dados.total;
    el('ind-novo').textContent = dados.porStatus.Novo;
    el('ind-atendimento').textContent = dados.porStatus['Em atendimento'];
    el('ind-finalizado').textContent = dados.porStatus.Finalizado;
    el('ind-alta').textContent = dados.altaPrioridade;
  }

  function montarBlocoAnalise(contato) {
    const bloco = criarElemento('div', 'analise');
    if (!contato.analise) {
      bloco.appendChild(criarElemento('p', 'analise-vazia', 'Ainda não analisado. Clique em "Analisar com IA".'));
      return bloco;
    }
    const { categoria, prioridade, resposta, modo } = contato.analise;
    const topo = criarElemento('div', 'analise-topo');
    topo.appendChild(criarElemento('span', 'chip categoria', categoria));
    topo.appendChild(criarElemento('span', `chip prioridade prioridade-${prioridade === 'Média' ? 'media' : prioridade.toLowerCase()}`, `Prioridade ${prioridade}`));
    const modoIA = modo === 'ia';
    topo.appendChild(
      criarElemento('span', `chip modo ${modoIA ? 'modo-ia' : 'modo-simulacao'}`, modoIA ? 'IA real (Gemini via n8n)' : 'SIMULAÇÃO · regras no n8n, sem IA')
    );
    bloco.appendChild(topo);
    const sugestao = criarElemento('blockquote', 'sugestao');
    sugestao.appendChild(criarElemento('span', 'rotulo', 'Resposta sugerida (não enviada)'));
    sugestao.appendChild(criarElemento('p', '', resposta));
    bloco.appendChild(sugestao);
    bloco.appendChild(criarElemento('p', 'data-analise', `Analisado em ${formatarData(contato.analise.analisadoEm)}`));
    return bloco;
  }

  function montarCartao(contato) {
    const item = criarElemento('li', 'contato');
    item.dataset.id = contato.id;

    const cabeca = criarElemento('div', 'contato-cabeca');
    const identificacao = criarElemento('div');
    identificacao.appendChild(criarElemento('h3', 'contato-nome', contato.nome));
    identificacao.appendChild(criarElemento('p', 'contato-fone', contato.whatsapp));
    cabeca.appendChild(identificacao);

    const seletor = criarElemento('div', 'campo status-campo');
    const rotulo = criarElemento('label', '', 'Status');
    const id = `status-${contato.id}`;
    rotulo.htmlFor = id;
    const select = criarElemento('select', 'status-select');
    select.id = id;
    select.dataset.acao = 'status';
    CRM.STATUS.forEach((status) => {
      const opcao = criarElemento('option', '', status);
      opcao.value = status;
      if (status === contato.status) opcao.selected = true;
      select.appendChild(opcao);
    });
    seletor.append(rotulo, select);
    cabeca.appendChild(seletor);
    item.appendChild(cabeca);

    item.appendChild(criarElemento('p', 'contato-mensagem', contato.mensagem));
    item.appendChild(montarBlocoAnalise(contato));

    const rodape = criarElemento('div', 'contato-rodape');
    const emAnalise = estado.emAnalise.has(contato.id);
    const botao = criarElemento('button', 'botao secundario', emAnalise ? 'Analisando…' : contato.analise ? 'Analisar novamente' : 'Analisar com IA');
    botao.type = 'button';
    botao.dataset.acao = 'analisar';
    botao.disabled = emAnalise;
    botao.setAttribute('aria-busy', String(emAnalise));
    rodape.appendChild(botao);
    rodape.appendChild(criarElemento('span', 'criado', `Cadastrado em ${formatarData(contato.criadoEm)}`));
    item.appendChild(rodape);

    const erroAnalise = criarElemento('p', 'erro-analise');
    erroAnalise.dataset.erroAnalise = contato.id;
    erroAnalise.setAttribute('role', 'alert');
    item.appendChild(erroAnalise);

    return item;
  }

  function renderizarLista() {
    const visiveis = CRM.filtrar(estado.contatos, estado.filtro);
    lista.replaceChildren(...visiveis.map(montarCartao));

    const semContatos = estado.contatos.length === 0;
    const semResultados = !semContatos && visiveis.length === 0;
    const vazio = el('estado-vazio');
    vazio.hidden = !(semContatos || semResultados);
    el('titulo-vazio').textContent = semContatos ? 'Nenhum interessado cadastrado' : 'Nenhum resultado para o filtro';
    el('texto-vazio').textContent = semContatos
      ? 'Cadastre o primeiro contato ao lado para começar a acompanhar os atendimentos.'
      : 'Ajuste a busca ou o status selecionado para ver outros interessados.';
    el('contador-lista').textContent = estado.contatos.length ? `(${visiveis.length} de ${estado.contatos.length})` : '';
  }

  function renderizarTudo() {
    renderizarIndicadores();
    renderizarLista();
  }

  function mostrarErroAnalise(id, texto) {
    const nodo = lista.querySelector(`[data-erro-analise="${CSS.escape(id)}"]`);
    if (nodo) nodo.textContent = texto;
  }

  function lerFormulario() {
    return { nome: campos.nome.value, whatsapp: campos.whatsapp.value, mensagem: campos.mensagem.value };
  }

  function aoCadastrar(evento) {
    evento.preventDefault();
    limparErros();
    const resultado = CRM.criarContato(lerFormulario());
    if (!resultado.ok) {
      Object.entries(resultado.erros).forEach(([campo, texto]) => {
        erros[campo].textContent = texto;
        campos[campo].setAttribute('aria-invalid', 'true');
      });
      mostrarAvisoFormulario('Corrija os campos destacados para cadastrar.', 'erro');
      campos[Object.keys(resultado.erros)[0]].focus();
      return;
    }
    estado.contatos = [resultado.contato, ...estado.contatos];
    persistir();
    formulario.reset();
    atualizarContador();
    renderizarTudo();
    mostrarAvisoFormulario(`${resultado.contato.nome} foi cadastrado como "Novo".`, 'sucesso');
    campos.nome.focus();
  }

  async function aoAnalisar(id) {
    if (estado.emAnalise.has(id)) return;
    const contato = estado.contatos.find((item) => item.id === id);
    if (!contato) return;

    estado.emAnalise.add(id);
    mostrarErroAnalise(id, '');
    renderizarLista();

    const resultado = await CRM.analisarContato(contato, window.fetch.bind(window));
    estado.emAnalise.delete(id);

    if (resultado.ok) {
      estado.contatos = CRM.registrarAnalise(estado.contatos, id, resultado.saida);
      persistir();
      renderizarTudo();
      return;
    }
    renderizarLista();
    const detalhe = resultado.codigo ? ` (${resultado.codigo})` : '';
    mostrarErroAnalise(id, `${resultado.mensagem}${detalhe}`);
  }

  function aoAlterarStatus(id, status) {
    try {
      estado.contatos = CRM.atualizarStatus(estado.contatos, id, status);
    } catch (erro) {
      mostrarAvisoFormulario(erro.message, 'erro');
      return;
    }
    persistir();
    renderizarTudo();
  }

  function ligarEventos() {
    formulario.addEventListener('submit', aoCadastrar);
    campos.mensagem.addEventListener('input', atualizarContador);
    Object.values(campos).forEach((campo) =>
      campo.addEventListener('input', () => {
        campo.removeAttribute('aria-invalid');
        const nodoErro = erros[campo.name];
        if (nodoErro) nodoErro.textContent = '';
      })
    );

    el('busca').addEventListener('input', (evento) => {
      estado.filtro.termo = evento.target.value;
      renderizarLista();
    });
    el('filtro-status').addEventListener('change', (evento) => {
      estado.filtro.status = evento.target.value;
      renderizarLista();
    });

    lista.addEventListener('click', (evento) => {
      const botao = evento.target.closest('button[data-acao="analisar"]');
      if (!botao) return;
      aoAnalisar(botao.closest('.contato').dataset.id);
    });
    lista.addEventListener('change', (evento) => {
      if (evento.target.dataset.acao !== 'status') return;
      aoAlterarStatus(evento.target.closest('.contato').dataset.id, evento.target.value);
    });
  }

  function iniciar() {
    const { contatos, aviso } = repositorio.carregar();
    estado.contatos = contatos;
    mostrarAvisoArmazenamento(aviso);
    atualizarContador();
    ligarEventos();
    renderizarTudo();
  }

  iniciar();
})();
