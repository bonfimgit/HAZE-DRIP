/*
  Promoções por campanha e preço promocional do produto.

  Uma campanha com "desconto_percentual" e produtos participantes
  aplica o desconto enquanto estiver ativa e dentro do período
  (inicio_em/fim_em). Fora do período, o preço volta ao normal
  sozinho — ativação e desativação automáticas.

  O produto também pode ter um "preco_promocional" próprio (de/por).
  Vale o menor preço entre a campanha e o preço promocional.
*/

const db = require('../config/db');
const { arredondar } = require('../utils/dinheiro');


// Condição SQL de campanha vigente agora
const CAMPANHA_VIGENTE = `
  c.ativo = TRUE
  AND (c.inicio_em IS NULL OR c.inicio_em <= NOW())
  AND (c.fim_em IS NULL OR c.fim_em > NOW())
`;


/*
  Devolve Map produtoId -> { desconto_percentual, campanha_id, campanha_titulo }
  com o maior desconto vigente de cada produto.
*/
async function descontosVigentes(produtoIds, conexao = db) {

  const ids = [...new Set(produtoIds.map(Number))].filter(Boolean);

  if (ids.length === 0) {
    return new Map();
  }

  const [linhas] = await conexao.query(
    `SELECT
        cp.produto_id,
        c.id AS campanha_id,
        c.titulo AS campanha_titulo,
        c.desconto_percentual
     FROM campanha_produtos cp
     INNER JOIN campanhas c ON c.id = cp.campanha_id
     WHERE cp.produto_id IN (?)
     AND c.desconto_percentual > 0
     AND ${CAMPANHA_VIGENTE}`,
    [ids]
  );

  const mapa = new Map();

  for (const linha of linhas) {
    const atual = mapa.get(linha.produto_id);
    if (!atual || Number(linha.desconto_percentual) > Number(atual.desconto_percentual)) {
      mapa.set(linha.produto_id, linha);
    }
  }

  return mapa;
}


function precoComDesconto(preco, percentual) {
  return arredondar(Number(preco) * (1 - Number(percentual) / 100));
}


/*
  Preço que o cliente paga, considerando a campanha vigente
  ("promocao", vinda de descontosVigentes) e o preço promocional
  do produto. Devolve:
    preco                preço efetivo
    preco_original       preço cheio, apenas quando há desconto
    desconto_percentual  desconto arredondado (ex.: 24 para "24% OFF")
    campanha             linha da campanha, se foi ela que valeu
*/
function calcularPreco(precoCheio, precoPromocional, promocao) {

  const cheio = Number(precoCheio);

  let preco = cheio;
  let campanha = null;

  const promocional = Number(precoPromocional);

  if (precoPromocional != null && promocional > 0 && promocional < cheio) {
    preco = promocional;
  }

  if (promocao) {
    const precoCampanha = precoComDesconto(cheio, promocao.desconto_percentual);
    if (precoCampanha < preco) {
      preco = precoCampanha;
      campanha = promocao;
    }
  }

  if (preco >= cheio) {
    return { preco: cheio, preco_original: null, desconto_percentual: 0, campanha: null };
  }

  return {
    preco,
    preco_original: cheio,
    desconto_percentual: Math.round((1 - preco / cheio) * 100),
    campanha
  };
}


/*
  Acrescenta preço promocional a produtos (listagens da loja):
    preco           preço efetivo (com desconto, se houver)
    preco_original  preço cheio, apenas quando há promoção
    promocao        { campanha, desconto_percentual }
*/
async function aplicarEmProdutos(produtos) {

  const descontos = await descontosVigentes(produtos.map(p => p.id));

  return produtos.map(produto => {

    const calculado = calcularPreco(
      produto.preco,
      produto.preco_promocional,
      descontos.get(produto.id)
    );

    if (!calculado.preco_original) {
      return { ...produto, preco_original: null, promocao: null };
    }

    return {
      ...produto,
      preco: calculado.preco,
      preco_original: calculado.preco_original,
      promocao: {
        campanha_id: calculado.campanha ? calculado.campanha.campanha_id : null,
        campanha: calculado.campanha ? calculado.campanha.campanha_titulo : null,
        desconto_percentual: calculado.desconto_percentual
      }
    };
  });
}


module.exports = {
  CAMPANHA_VIGENTE,
  descontosVigentes,
  precoComDesconto,
  calcularPreco,
  aplicarEmProdutos
};
