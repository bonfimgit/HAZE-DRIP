/* =============================================================
   CALCULAR FRETE NA SACOLA

   O cliente digita o CEP e vê o frete antes de ir para o checkout:
   valor, prazo, opções (PAC/SEDEX, quando os Correios estão ativos)
   e quanto falta para o frete grátis.

   Usa a mesma cotação do checkout (POST /checkout/cotacao), então os
   valores batem. O CEP fica salvo e o checkout já abre preenchido.
============================================================= */

(() => {

  const form = document.getElementById('sacola-frete-form');
  const Cliente = window.HazeCliente;

  if (!form || !Cliente) {
    return;
  }

  const CHAVE_CEP = 'hazeCep';

  const campoCep = document.getElementById('sacola-cep');
  const botao = document.getElementById('sacola-frete-botao');
  const caixaOpcoes = document.getElementById('sacola-frete-opcoes');
  const info = document.getElementById('sacola-frete-info');
  const linhaFrete = document.getElementById('sacola-frete-linha');
  const valorFrete = document.getElementById('sacola-frete');
  const subtotalEl = document.getElementById('sacola-subtotal');
  const totalEl = document.getElementById('sacola-total');

  let cepCalculado = '';
  let servicoEscolhido = '';
  let recotacaoAgendada = null;
  let requisicaoAtual = 0;


  const moeda = valor =>
    Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const somenteDigitos = valor => String(valor || '').replace(/\D/g, '');

  function formatarCep(valor) {
    const digitos = somenteDigitos(valor).slice(0, 8);
    return digitos.length > 5 ? `${digitos.slice(0, 5)}-${digitos.slice(5)}` : digitos;
  }

  function textoPrazo(minimo, maximo) {
    if (maximo == null) return '';
    if (minimo == null || minimo === maximo) return `${maximo} ${maximo === 1 ? 'dia útil' : 'dias úteis'}`;
    return `${minimo} a ${maximo} dias úteis`;
  }

  // Itens que contam para o frete (os indisponíveis ficam de fora, como no checkout)
  function itensDaSacola() {
    return Cliente.lerCarrinho()
      .filter(item => item.disponivel !== false)
      .map(item => ({
        variacao_id: Number(item.variacaoId),
        quantidade: Number(item.quantidade)
      }));
  }

  function lerCepSalvo() {
    try {
      return localStorage.getItem(CHAVE_CEP) || '';
    } catch {
      return '';
    }
  }

  function salvarCep(cep) {
    try {
      localStorage.setItem(CHAVE_CEP, cep);
    } catch {
      // Navegação privada: só não lembra o CEP
    }
  }

  function mostrarInfo(texto, erro = false) {
    info.textContent = texto || '';
    info.classList.toggle('erro', erro);
  }

  function limparResultado() {
    linhaFrete.hidden = true;
    caixaOpcoes.hidden = true;
    caixaOpcoes.innerHTML = '';
  }


  /* -----------------------------------------------------------
     COTAÇÃO
  ----------------------------------------------------------- */

  async function calcular(cep) {

    const itens = itensDaSacola();

    if (itens.length === 0) {
      limparResultado();
      mostrarInfo('');
      return;
    }

    // Ignora respostas antigas se o cliente calcular de novo rápido
    const requisicao = ++requisicaoAtual;

    botao.disabled = true;
    botao.textContent = 'Calculando...';
    mostrarInfo('');

    try {

      const cotacao = await Cliente.api('/checkout/cotacao', {
        metodo: 'POST',
        corpo: {
          itens,
          cep,
          servico_frete: servicoEscolhido || undefined
        }
      });

      if (requisicao !== requisicaoAtual) {
        return;
      }

      cepCalculado = cep;
      salvarCep(formatarCep(cep));
      mostrarCotacao(cotacao);

    } catch (erro) {

      if (requisicao !== requisicaoAtual) {
        return;
      }

      limparResultado();
      mostrarInfo(erro.message || 'Não foi possível calcular o frete agora.', true);

    } finally {

      if (requisicao === requisicaoAtual) {
        botao.disabled = false;
        botao.textContent = 'Calcular';
      }
    }
  }

  function mostrarCotacao(cotacao) {

    const frete = cotacao.frete;

    // Valores do servidor (preços atuais do banco)
    subtotalEl.textContent = moeda(cotacao.subtotal);

    if (!frete) {
      limparResultado();
      totalEl.textContent = moeda(cotacao.subtotal);
      mostrarInfo(cotacao.erro_frete || 'Não foi possível calcular o frete para este CEP.', true);
      return;
    }

    linhaFrete.hidden = false;
    valorFrete.textContent = frete.gratis ? 'Grátis' : moeda(frete.valor);
    totalEl.textContent = moeda(cotacao.total);

    mostrarOpcoes(frete);

    const prazo = textoPrazo(frete.prazo_min_dias, frete.prazo_max_dias);
    let texto = prazo ? `${frete.descricao}: entrega em ${prazo}.` : `${frete.descricao}.`;

    if (!frete.gratis && frete.gratis_acima) {
      const falta = frete.gratis_acima - cotacao.subtotal;
      if (falta > 0) {
        texto += ` Faltam ${moeda(falta)} para frete grátis.`;
      }
    }

    mostrarInfo(texto);
  }

  // Opções dos Correios (PAC, SEDEX...), quando a integração está ativa
  function mostrarOpcoes(frete) {

    const opcoes = Array.isArray(frete.opcoes) ? frete.opcoes : [];

    servicoEscolhido = frete.servico || '';
    caixaOpcoes.hidden = opcoes.length < 2;

    caixaOpcoes.innerHTML = opcoes.map(opcao => {
      const prazo = textoPrazo(opcao.prazo_dias, opcao.prazo_dias);
      return `
        <label class="sacola-frete-opcao">
          <input type="radio" name="sacola_servico_frete" value="${escaparHtml(opcao.codigo)}" ${opcao.codigo === servicoEscolhido ? 'checked' : ''}>
          <span>
            <strong>${escaparHtml([opcao.transportadora, opcao.nome].filter(Boolean).join(' '))} · ${opcao.gratis ? 'Grátis' : moeda(opcao.valor)}</strong>
            ${prazo ? `<small>Entrega em até ${escaparHtml(prazo)}</small>` : ''}
          </span>
        </label>`;
    }).join('');
  }


  /* -----------------------------------------------------------
     EVENTOS
  ----------------------------------------------------------- */

  campoCep.addEventListener('input', () => {
    campoCep.value = formatarCep(campoCep.value);
    campoCep.classList.remove('campo-erro');
  });

  form.addEventListener('submit', evento => {

    evento.preventDefault();

    const cep = somenteDigitos(campoCep.value);

    if (cep.length !== 8) {
      campoCep.classList.add('campo-erro');
      mostrarInfo('Digite um CEP com 8 números.', true);
      campoCep.focus();
      return;
    }

    servicoEscolhido = cep === cepCalculado ? servicoEscolhido : '';
    calcular(cep);
  });

  caixaOpcoes.addEventListener('change', evento => {
    if (evento.target.name === 'sacola_servico_frete') {
      servicoEscolhido = evento.target.value;
      calcular(cepCalculado);
    }
  });

  /*
    Mudou a sacola (quantidade, item removido): o frete e o total
    mudam junto. Recalcula se o cliente já tinha calculado.
  */
  document.addEventListener('sacola:atualizada', () => {

    const vazia = itensDaSacola().length === 0;
    form.hidden = vazia;

    if (vazia) {
      limparResultado();
      return;
    }

    if (cepCalculado) {
      clearTimeout(recotacaoAgendada);
      recotacaoAgendada = setTimeout(() => calcular(cepCalculado), 300);
    }
  });


  /* -----------------------------------------------------------
     INÍCIO: CEP salvo de uma visita anterior
  ----------------------------------------------------------- */

  form.hidden = itensDaSacola().length === 0;

  const cepSalvo = lerCepSalvo();

  if (cepSalvo) {
    campoCep.value = formatarCep(cepSalvo);
    if (somenteDigitos(cepSalvo).length === 8 && !form.hidden) {
      calcular(somenteDigitos(cepSalvo));
    }
  }

})();
