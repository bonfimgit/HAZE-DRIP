/* =============================================================
   HAZE DRIP — PÁGINAS DA CONTA DO CLIENTE
   -------------------------------------------------------------
   conta.html, minha-conta.html, recuperar-senha.html,
   redefinir-senha.html e verificar-email.html.
   Cada bloco só roda se a página tiver os elementos dele.
============================================================= */

(function () {

  const Cliente = window.HazeCliente;

  const $ = id => document.getElementById(id);


  /* ===========================================================
     UTILITÁRIOS
  =========================================================== */

  function mensagem(elemento, texto, sucesso = false) {
    if (!elemento) return;
    elemento.textContent = texto || '';
    elemento.classList.toggle('sucesso', Boolean(sucesso && texto));
  }

  /*
    Desativa o botão enquanto a ação roda e mostra a mensagem
    de erro da API, se houver.
  */
  async function executar(form, elementoMensagem, acao) {

    const botao = form.querySelector('button[type="submit"]');
    const textoBotao = botao ? botao.textContent : '';

    mensagem(elementoMensagem, '');

    if (botao) {
      botao.disabled = true;
      botao.textContent = 'Aguarde...';
    }

    try {
      await acao();
    } catch (erro) {
      mensagem(elementoMensagem, erro.message);
    } finally {
      if (botao) {
        botao.disabled = false;
        botao.textContent = textoBotao;
      }
    }
  }

  function senhaValida(senha) {
    return senha.length >= 8 && /[A-Za-z]/.test(senha) && /\d/.test(senha);
  }

  function formatarData(valor, comHora = false) {
    if (!valor) return '';
    const data = new Date(valor);
    return comHora
      ? data.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
      : data.toLocaleDateString('pt-BR');
  }

  function mascaraTelefone(input) {
    if (!input) return;
    input.addEventListener('input', () => {
      const digitos = input.value.replace(/\D/g, '').slice(0, 11);
      let valor = digitos.replace(/^(\d{2})(\d)/, '($1) $2');
      valor = valor.replace(digitos.length <= 10 ? /(\d{4})(\d)/ : /(\d{5})(\d)/, '$1-$2');
      input.value = valor;
    });
  }

  function mascaraCep(input) {
    if (!input) return;
    input.addEventListener('input', () => {
      let valor = input.value.replace(/\D/g, '').slice(0, 8);
      if (valor.length > 5) valor = `${valor.slice(0, 5)}-${valor.slice(5)}`;
      input.value = valor;
    });
  }

  // Destino seguro após login: só páginas da própria loja
  function destinoAposLogin() {
    const voltar = new URLSearchParams(window.location.search).get('voltar');
    if (voltar && /^[a-z0-9-]+\.html([?#][^\s]*)?$/i.test(voltar)) {
      return voltar;
    }
    return 'minha-conta.html';
  }


  const NOMES_STATUS = {
    aguardando_pagamento: 'Aguardando pagamento',
    pago: 'Pagamento aprovado',
    em_preparacao: 'Em preparação',
    enviado: 'Enviado',
    entregue: 'Entregue',
    cancelado: 'Cancelado'
  };

  const nomeStatus = status => NOMES_STATUS[status] || status;


  /* ===========================================================
     ENTRAR / CRIAR CONTA (conta.html)
  =========================================================== */

  const formLogin = $('form-login');

  if (formLogin) {

    if (Cliente.estaLogado()) {
      window.location.href = destinoAposLogin();
      return;
    }

    // Abas
    document.querySelectorAll('.conta-aba').forEach(aba => {
      aba.addEventListener('click', () => mostrarAba(aba.dataset.aba));
    });

    function mostrarAba(nome) {
      document.querySelectorAll('.conta-aba').forEach(aba => {
        const ativa = aba.dataset.aba === nome;
        aba.classList.toggle('ativa', ativa);
        aba.setAttribute('aria-selected', ativa ? 'true' : 'false');
      });
      document.querySelectorAll('[data-painel]').forEach(painel => {
        painel.hidden = painel.dataset.painel !== nome;
      });
    }

    if (window.location.hash === '#cadastrar') {
      mostrarAba('cadastrar');
    }

    async function concluirLogin(sessao) {
      Cliente.salvarSessao(sessao);
      try {
        await Cliente.mesclarCarrinhoNoLogin();
      } catch {}
      window.location.href = destinoAposLogin();
    }

    formLogin.addEventListener('submit', evento => {

      evento.preventDefault();

      const email = $('login-email').value.trim();
      const senha = $('login-senha').value;
      const saida = $('login-mensagem');

      if (!email || !senha) {
        mensagem(saida, 'Preencha e-mail e senha.');
        return;
      }

      executar(formLogin, saida, async () => {
        const sessao = await Cliente.api('/clientes/login', {
          metodo: 'POST',
          corpo: { email, senha },
          autenticado: false
        });
        await concluirLogin(sessao);
      });
    });

    const formCadastro = $('form-cadastro');

    mascaraTelefone($('cadastro-telefone'));

    formCadastro.addEventListener('submit', evento => {

      evento.preventDefault();

      const saida = $('cadastro-mensagem');
      const nome = $('cadastro-nome').value.trim();
      const email = $('cadastro-email').value.trim();
      const telefone = $('cadastro-telefone').value.trim();
      const senha = $('cadastro-senha').value;

      if (nome.length < 2) return mensagem(saida, 'Informe seu nome.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return mensagem(saida, 'Informe um e-mail válido.');
      if (!senhaValida(senha)) return mensagem(saida, 'A senha deve ter pelo menos 8 caracteres, com letras e números.');
      if (!$('cadastro-termos').checked) return mensagem(saida, 'Aceite os termos de uso e a política de privacidade.');

      executar(formCadastro, saida, async () => {
        const sessao = await Cliente.api('/clientes/cadastro', {
          metodo: 'POST',
          corpo: { nome, email, telefone: telefone || undefined, senha },
          autenticado: false
        });
        await concluirLogin(sessao);
      });
    });
  }


  /* ===========================================================
     RECUPERAR SENHA
  =========================================================== */

  const formRecuperar = $('form-recuperar');

  if (formRecuperar) {

    formRecuperar.addEventListener('submit', evento => {

      evento.preventDefault();

      const saida = $('recuperar-mensagem');
      const email = $('recuperar-email').value.trim();

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return mensagem(saida, 'Informe um e-mail válido.');
      }

      executar(formRecuperar, saida, async () => {
        const resposta = await Cliente.api('/clientes/recuperar-senha', {
          metodo: 'POST',
          corpo: { email },
          autenticado: false
        });
        mensagem(saida, resposta.mensagem, true);
        formRecuperar.reset();
      });
    });
  }


  /* ===========================================================
     REDEFINIR SENHA
  =========================================================== */

  const formRedefinir = $('form-redefinir');

  if (formRedefinir) {

    const token = new URLSearchParams(window.location.search).get('token');
    const saida = $('redefinir-mensagem');

    if (!token) {
      mensagem(saida, 'Link inválido. Peça um novo e-mail de recuperação.');
      formRedefinir.querySelector('button').disabled = true;
    }

    formRedefinir.addEventListener('submit', evento => {

      evento.preventDefault();

      const senha = $('redefinir-senha').value;

      if (!senhaValida(senha)) {
        return mensagem(saida, 'A senha deve ter pelo menos 8 caracteres, com letras e números.');
      }

      if (senha !== $('redefinir-confirmacao').value) {
        return mensagem(saida, 'As senhas não conferem.');
      }

      executar(formRedefinir, saida, async () => {
        const resposta = await Cliente.api('/clientes/redefinir-senha', {
          metodo: 'POST',
          corpo: { token, senha },
          autenticado: false
        });
        Cliente.limparSessao();
        mensagem(saida, resposta.mensagem, true);
        formRedefinir.querySelector('button').disabled = true;
        setTimeout(() => { window.location.href = 'conta.html'; }, 2000);
      });
    });
  }


  /* ===========================================================
     VERIFICAR E-MAIL
  =========================================================== */

  const saidaVerificacao = $('verificar-mensagem');

  if (saidaVerificacao) {

    const token = new URLSearchParams(window.location.search).get('token');

    Cliente.api('/clientes/verificar-email', {
      metodo: 'POST',
      corpo: { token },
      autenticado: false
    })
      .then(resposta => {
        mensagem(saidaVerificacao, resposta.mensagem, true);
        $('verificar-continuar').hidden = false;
      })
      .catch(erro => {
        mensagem(saidaVerificacao, erro.message);
      });
  }


  /* ===========================================================
     MINHA CONTA
  =========================================================== */

  const menuConta = document.querySelector('.conta-menu');

  if (!menuConta) {
    return;
  }

  if (!Cliente.exigirLogin()) {
    return;
  }

  $('conta-sair').addEventListener('click', () => Cliente.sair());


  /* ---------- Navegação entre seções ---------- */

  const secoes = ['pedidos', 'dados', 'enderecos', 'avaliacoes', 'seguranca', 'privacidade'];

  function mostrarSecao() {

    const atual = window.location.hash.replace('#', '');
    const nome = secoes.includes(atual) ? atual : 'pedidos';

    document.querySelectorAll('.conta-secao').forEach(secao => {
      secao.hidden = secao.dataset.secao !== nome;
    });

    document.querySelectorAll('.conta-menu-link').forEach(link => {
      const ativo = link.dataset.secao === nome;
      link.classList.toggle('ativo', ativo);
      if (ativo) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  }

  window.addEventListener('hashchange', mostrarSecao);
  mostrarSecao();


  /* ---------- Perfil ---------- */

  async function carregarPerfil() {

    const perfil = await Cliente.api('/clientes/me');

    $('conta-nome').textContent = perfil.nome.split(' ')[0];
    $('dados-nome').value = perfil.nome;
    $('dados-email').value = perfil.email;
    $('dados-telefone').value = perfil.telefone || '';
    $('conta-aviso-email').hidden = perfil.email_verificado;
  }

  mascaraTelefone($('dados-telefone'));

  $('form-dados').addEventListener('submit', evento => {

    evento.preventDefault();

    const saida = $('dados-mensagem');

    executar(evento.target, saida, async () => {
      const perfil = await Cliente.api('/clientes/me', {
        metodo: 'PUT',
        corpo: {
          nome: $('dados-nome').value.trim(),
          telefone: $('dados-telefone').value.trim() || undefined
        }
      });
      $('conta-nome').textContent = perfil.nome.split(' ')[0];
      mensagem(saida, 'Dados atualizados.', true);
    });
  });

  $('conta-reenviar').addEventListener('click', async evento => {
    const botao = evento.target;
    botao.disabled = true;
    try {
      const resposta = await Cliente.api('/clientes/me/reenviar-verificacao', { metodo: 'POST' });
      botao.textContent = resposta.mensagem;
    } catch (erro) {
      botao.textContent = erro.message;
    }
  });


  /* ---------- Pedidos ---------- */

  async function carregarPedidos() {

    const lista = $('pedidos-lista');
    const pedidos = await Cliente.api('/clientes/me/pedidos');

    if (pedidos.length === 0) {
      lista.innerHTML = `
        <div class="conta-vazio">
          <p>Você ainda não fez pedidos.</p>
          <a href="catalogo.html" class="btn conta-botao-pequeno">Ver catálogo</a>
        </div>`;
      return;
    }

    lista.innerHTML = pedidos.map(pedido => `
      <button type="button" class="conta-pedido" data-pedido-id="${Number(pedido.id)}">
        <span class="conta-pedido-numero">Pedido #${Number(pedido.id)}</span>
        <span class="conta-pedido-data">${escaparHtml(formatarData(pedido.criado_em))}</span>
        <span class="conta-status conta-status-${escaparHtml(pedido.status)}">${escaparHtml(nomeStatus(pedido.status))}</span>
        <span class="conta-pedido-itens">${Number(pedido.quantidade_itens)} item(ns)</span>
        <strong class="conta-pedido-total">${formatarMoeda(pedido.total)}</strong>
      </button>`).join('');

    lista.querySelectorAll('.conta-pedido').forEach(botao => {
      botao.addEventListener('click', () => abrirPedido(Number(botao.dataset.pedidoId)));
    });
  }


  async function abrirPedido(pedidoId) {

    const detalhe = $('pedido-detalhe');
    const conteudo = $('pedido-detalhe-conteudo');

    $('pedidos-lista').hidden = true;
    detalhe.hidden = false;
    conteudo.innerHTML = '<p class="conta-carregando">Carregando pedido...</p>';

    try {

      const pedido = await Cliente.api(`/clientes/me/pedidos/${pedidoId}`);

      const itens = pedido.itens.map(item => `
        <li>
          <span>${escaparHtml(item.produto_nome)} — ${escaparHtml(item.cor)} / ${escaparHtml(item.tamanho)} · ${Number(item.quantidade)}x</span>
          <strong>${formatarMoeda(item.subtotal)}</strong>
        </li>`).join('');

      const historico = pedido.historico.map(etapa => `
        <li>
          <strong>${escaparHtml(nomeStatus(etapa.status_novo))}</strong>
          <span>${escaparHtml(formatarData(etapa.criado_em, true))}</span>
        </li>`).join('');

      const rastreio = pedido.codigo_rastreio
        ? `<div class="conta-rastreio">
             <span>Código de rastreio${pedido.transportadora ? ` (${escaparHtml(pedido.transportadora)})` : ''}:</span>
             <strong>${escaparHtml(pedido.codigo_rastreio)}</strong>
             ${pedido.url_rastreio && /^https?:\/\//i.test(pedido.url_rastreio)
               ? `<a href="${escaparHtml(pedido.url_rastreio)}" target="_blank" rel="noopener">Acompanhar entrega →</a>`
               : ''}
           </div>`
        : '';

      const pagamento = pedido.status === 'aguardando_pagamento' && pedido.pagamento_url && /^https:\/\//i.test(pedido.pagamento_url)
        ? `<a href="${escaparHtml(pedido.pagamento_url)}" class="btn conta-botao-pequeno" target="_blank" rel="noopener">Pagar agora</a>`
        : '';

      const desconto = Number(pedido.desconto || 0) > 0
        ? `<div><span>Desconto</span><span>- ${formatarMoeda(pedido.desconto)}</span></div>`
        : '';

      conteudo.innerHTML = `
        <div class="conta-pedido-cabecalho">
          <h3>Pedido #${Number(pedido.id)}</h3>
          <span class="conta-status conta-status-${escaparHtml(pedido.status)}">${escaparHtml(nomeStatus(pedido.status))}</span>
        </div>
        <p class="conta-texto">Feito em ${escaparHtml(formatarData(pedido.criado_em, true))}</p>
        ${pagamento}
        ${rastreio}
        <h4>Itens</h4>
        <ul class="conta-lista-itens">${itens}</ul>
        <div class="conta-totais">
          <div><span>Subtotal</span><span>${formatarMoeda(pedido.subtotal)}</span></div>
          ${desconto}
          <div><span>Frete</span><span>${formatarMoeda(pedido.frete)}</span></div>
          <div class="conta-total"><span>Total</span><span>${formatarMoeda(pedido.total)}</span></div>
        </div>
        <h4>Entrega</h4>
        <p class="conta-texto">
          ${escaparHtml(pedido.endereco_rua)}, ${escaparHtml(pedido.endereco_numero)}
          ${pedido.endereco_complemento ? ` — ${escaparHtml(pedido.endereco_complemento)}` : ''}<br>
          ${escaparHtml(pedido.endereco_bairro)} — ${escaparHtml(pedido.endereco_cidade)}/${escaparHtml(pedido.endereco_estado)} — CEP ${escaparHtml(pedido.endereco_cep)}
        </p>
        <h4>Acompanhamento</h4>
        <ol class="conta-historico">${historico}</ol>`;

    } catch (erro) {
      conteudo.innerHTML = `<p class="conta-mensagem">${escaparHtml(erro.message)}</p>`;
    }
  }

  $('pedido-voltar').addEventListener('click', () => {
    $('pedido-detalhe').hidden = true;
    $('pedidos-lista').hidden = false;
  });


  /* ---------- Endereços ---------- */

  let enderecos = [];

  async function carregarEnderecos() {

    enderecos = await Cliente.api('/clientes/me/enderecos');

    const lista = $('enderecos-lista');

    if (enderecos.length === 0) {
      lista.innerHTML = '<p class="conta-vazio">Nenhum endereço cadastrado.</p>';
      return;
    }

    lista.innerHTML = enderecos.map(endereco => `
      <article class="checkout-bloco conta-endereco${Number(endereco.principal) ? ' principal' : ''}">
        <div>
          <strong>${escaparHtml(endereco.apelido || 'Endereço')}</strong>
          ${Number(endereco.principal) ? '<span class="conta-selo">Principal</span>' : ''}
          <p class="conta-texto">
            ${endereco.destinatario ? `${escaparHtml(endereco.destinatario)}<br>` : ''}
            ${escaparHtml(endereco.rua)}, ${escaparHtml(endereco.numero)}${endereco.complemento ? ` — ${escaparHtml(endereco.complemento)}` : ''}<br>
            ${escaparHtml(endereco.bairro)} — ${escaparHtml(endereco.cidade)}/${escaparHtml(endereco.estado)} — ${escaparHtml(endereco.cep)}
          </p>
        </div>
        <div class="conta-acoes">
          <button type="button" class="conta-link-botao" data-acao="editar" data-id="${Number(endereco.id)}">Editar</button>
          ${Number(endereco.principal) ? '' : `<button type="button" class="conta-link-botao" data-acao="principal" data-id="${Number(endereco.id)}">Tornar principal</button>`}
          <button type="button" class="conta-link-botao perigo" data-acao="remover" data-id="${Number(endereco.id)}">Remover</button>
        </div>
      </article>`).join('');
  }

  $('enderecos-lista').addEventListener('click', async evento => {

    const botao = evento.target.closest('button[data-acao]');
    if (!botao) return;

    const id = Number(botao.dataset.id);

    try {

      if (botao.dataset.acao === 'editar') {
        abrirFormularioEndereco(enderecos.find(e => e.id === id));
        return;
      }

      if (botao.dataset.acao === 'principal') {
        await Cliente.api(`/clientes/me/enderecos/${id}/principal`, { metodo: 'PATCH' });
      }

      if (botao.dataset.acao === 'remover') {
        if (!confirm('Remover este endereço?')) return;
        await Cliente.api(`/clientes/me/enderecos/${id}`, { metodo: 'DELETE' });
      }

      await carregarEnderecos();

    } catch (erro) {
      alert(erro.message);
    }
  });


  const formEndereco = $('form-endereco');
  const camposEndereco = ['apelido', 'destinatario', 'cep', 'rua', 'numero', 'complemento', 'bairro', 'cidade', 'estado'];

  function abrirFormularioEndereco(endereco = null) {

    formEndereco.hidden = false;
    $('endereco-form-titulo').textContent = endereco ? 'Editar endereço' : 'Novo endereço';
    $('endereco-id').value = endereco ? endereco.id : '';

    camposEndereco.forEach(campo => {
      $(`endereco-${campo}`).value = endereco ? (endereco[campo] || '') : '';
    });

    $('endereco-principal').checked = endereco ? Boolean(Number(endereco.principal)) : false;
    mensagem($('endereco-mensagem'), '');
    $('endereco-cep').focus();
  }

  $('endereco-novo').addEventListener('click', () => abrirFormularioEndereco());
  $('endereco-cancelar').addEventListener('click', () => { formEndereco.hidden = true; });

  mascaraCep($('endereco-cep'));

  // Preenche o endereço pelo CEP (ViaCEP)
  $('endereco-cep').addEventListener('blur', async () => {

    const cep = $('endereco-cep').value.replace(/\D/g, '');
    if (cep.length !== 8) return;

    try {
      const resposta = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const dados = await resposta.json();
      if (dados.erro) return;
      $('endereco-rua').value = dados.logradouro || $('endereco-rua').value;
      $('endereco-bairro').value = dados.bairro || $('endereco-bairro').value;
      $('endereco-cidade').value = dados.localidade || $('endereco-cidade').value;
      $('endereco-estado').value = dados.uf || $('endereco-estado').value;
      $('endereco-numero').focus();
    } catch {}
  });

  formEndereco.addEventListener('submit', evento => {

    evento.preventDefault();

    const saida = $('endereco-mensagem');
    const id = $('endereco-id').value;

    const corpo = {};
    camposEndereco.forEach(campo => {
      corpo[campo] = $(`endereco-${campo}`).value.trim() || undefined;
    });
    corpo.principal = $('endereco-principal').checked;

    if (!corpo.cep || !corpo.rua || !corpo.numero || !corpo.bairro || !corpo.cidade || !corpo.estado) {
      return mensagem(saida, 'Preencha CEP, rua, número, bairro, cidade e estado.');
    }

    executar(formEndereco, saida, async () => {
      await Cliente.api(
        id ? `/clientes/me/enderecos/${id}` : '/clientes/me/enderecos',
        { metodo: id ? 'PUT' : 'POST', corpo }
      );
      formEndereco.hidden = true;
      await carregarEnderecos();
    });
  });


  /* ---------- Avaliações ---------- */

  async function carregarAvaliacoes() {

    const lista = $('avaliacoes-produtos');
    const produtos = await Cliente.api('/clientes/me/avaliacoes');

    if (produtos.length === 0) {
      lista.innerHTML = '<p class="conta-vazio">Quando um pedido for entregue, você poderá avaliar os produtos aqui.</p>';
      return;
    }

    lista.innerHTML = produtos.map(produto => `
      <form class="checkout-bloco conta-form conta-avaliacao" data-produto="${Number(produto.produto_id)}" novalidate>
        <div class="conta-secao-topo">
          <a href="produto.html?id=${Number(produto.produto_id)}" class="conta-link"><strong>${escaparHtml(produto.produto_nome)}</strong></a>
          ${produto.avaliacao_id ? '<span class="conta-selo">Avaliado</span>' : ''}
        </div>
        <fieldset class="conta-estrelas">
          <legend class="visually-hidden">Nota</legend>
          ${[5, 4, 3, 2, 1].map(nota => `
            <label>
              <input type="radio" name="nota-${Number(produto.produto_id)}" value="${nota}" ${Number(produto.nota) === nota ? 'checked' : ''}>
              <span aria-hidden="true">★</span>
              <span class="visually-hidden">${nota} estrela(s)</span>
            </label>`).join('')}
        </fieldset>
        <div class="checkout-campo">
          <label for="titulo-${Number(produto.produto_id)}">Título (opcional)</label>
          <input type="text" id="titulo-${Number(produto.produto_id)}" maxlength="100" value="${escaparHtml(produto.titulo || '')}">
        </div>
        <div class="checkout-campo">
          <label for="comentario-${Number(produto.produto_id)}">Comentário (opcional)</label>
          <textarea id="comentario-${Number(produto.produto_id)}" rows="3" maxlength="2000">${escaparHtml(produto.comentario || '')}</textarea>
        </div>
        <p class="conta-mensagem" role="status"></p>
        <button type="submit" class="btn conta-botao-pequeno">${produto.avaliacao_id ? 'Atualizar avaliação' : 'Enviar avaliação'}</button>
      </form>`).join('');
  }

  $('avaliacoes-produtos').addEventListener('submit', evento => {

    const form = evento.target.closest('.conta-avaliacao');
    if (!form) return;

    evento.preventDefault();

    const produtoId = Number(form.dataset.produto);
    const saida = form.querySelector('.conta-mensagem');
    const nota = form.querySelector('input[type="radio"]:checked');

    if (!nota) {
      return mensagem(saida, 'Escolha uma nota de 1 a 5 estrelas.');
    }

    executar(form, saida, async () => {
      await Cliente.api('/clientes/me/avaliacoes', {
        metodo: 'POST',
        corpo: {
          produto_id: produtoId,
          nota: Number(nota.value),
          titulo: $(`titulo-${produtoId}`).value.trim() || undefined,
          comentario: $(`comentario-${produtoId}`).value.trim() || undefined
        }
      });
      mensagem(saida, 'Obrigado pela avaliação!', true);
    });
  });


  /* ---------- Senha ---------- */

  $('form-senha').addEventListener('submit', evento => {

    evento.preventDefault();

    const saida = $('senha-mensagem');
    const senhaAtual = $('senha-atual').value;
    const senhaNova = $('senha-nova').value;

    if (!senhaValida(senhaNova)) {
      return mensagem(saida, 'A nova senha deve ter pelo menos 8 caracteres, com letras e números.');
    }

    executar(evento.target, saida, async () => {
      const sessao = await Cliente.api('/clientes/me/senha', {
        metodo: 'PATCH',
        corpo: { senha_atual: senhaAtual, senha_nova: senhaNova }
      });
      Cliente.salvarSessao(sessao);
      evento.target.reset();
      mensagem(saida, sessao.mensagem, true);
    });
  });


  /* ---------- Privacidade ---------- */

  $('privacidade-exportar').addEventListener('click', async evento => {

    const botao = evento.target;
    botao.disabled = true;

    try {
      const dados = await Cliente.api('/clientes/me/dados');
      const arquivo = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(arquivo);
      link.download = 'meus-dados-haze-drip.json';
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (erro) {
      alert(erro.message);
    } finally {
      botao.disabled = false;
    }
  });

  $('form-excluir').addEventListener('submit', evento => {

    evento.preventDefault();

    const saida = $('excluir-mensagem');
    const senha = $('excluir-senha').value;

    if (!senha) {
      return mensagem(saida, 'Confirme sua senha.');
    }

    if (!confirm('Tem certeza? Sua conta será excluída e isso não pode ser desfeito.')) {
      return;
    }

    executar(evento.target, saida, async () => {
      await Cliente.api('/clientes/me', { metodo: 'DELETE', corpo: { senha } });
      Cliente.limparSessao();
      localStorage.removeItem('hazeCarrinho');
      alert('Sua conta foi excluída.');
      window.location.href = 'index.html';
    });
  });


  /* ---------- Carregamento inicial ---------- */

  Promise.all([carregarPerfil(), carregarPedidos(), carregarEnderecos(), carregarAvaliacoes()])
    .catch(erro => {
      if (erro.status === 401) {
        Cliente.exigirLogin();
        return;
      }
      $('pedidos-lista').innerHTML = `<p class="conta-mensagem">${escaparHtml(erro.message)}</p>`;
    });

})();
