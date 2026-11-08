/*
  Campo "Desconto (%)" do cadastro e da edição de produto.

  O banco guarda o PREÇO promocional (preco_promocional). Este campo
  é um atalho: digitar 10 preenche o preço promocional com 10% a
  menos que o preço; mudar o preço ou o preço promocional atualiza
  a %. Vazio ou 0 = sem promoção (sem selo "% OFF" na loja).

  Ligação pelo HTML:
    <input id="..." data-desconto-preco="<id do preço>"
                    data-desconto-promocional="<id do preço promocional>">

  A página de edição preenche os preços depois de carregar o produto
  e chama window.atualizarDescontoPercentual() para mostrar a %.
*/

(function () {

  const campos = [...document.querySelectorAll('[data-desconto-preco]')];

  function ligar(campoDesconto) {

    const preco = document.getElementById(campoDesconto.dataset.descontoPreco);
    const promocional = document.getElementById(campoDesconto.dataset.descontoPromocional);

    if (!preco || !promocional) return null;

    // % a partir dos preços (arredondada, como a loja mostra)
    function mostrarPercentual() {

      const normal = Number(preco.value);
      const promo = promocional.value === '' ? null : Number(promocional.value);

      if (!normal || promo == null || !(promo > 0) || promo >= normal) {
        campoDesconto.value = '';
        return;
      }

      campoDesconto.value = Math.round((1 - promo / normal) * 100);
    }

    // Preço promocional a partir da %
    function aplicarPercentual() {

      const normal = Number(preco.value);
      const percentual = Number(campoDesconto.value);

      if (campoDesconto.value === '' || percentual <= 0) {
        promocional.value = ''; // sem desconto = sem promoção
        return;
      }

      if (!normal || percentual >= 100) return;

      promocional.value = (Math.round(normal * (100 - percentual)) / 100).toFixed(2);
    }

    campoDesconto.addEventListener('input', aplicarPercentual);
    promocional.addEventListener('input', mostrarPercentual);

    // Mudou o preço com % preenchida: mantém a % e recalcula o promocional
    preco.addEventListener('input', () => {
      if (campoDesconto.value !== '') aplicarPercentual();
    });

    return mostrarPercentual;
  }

  const atualizadores = campos.map(ligar).filter(Boolean);

  window.atualizarDescontoPercentual = () => atualizadores.forEach(f => f());

})();
