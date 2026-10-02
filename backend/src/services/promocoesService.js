/*
  Promoções por campanha.

  Uma campanha com "desconto_percentual" e produtos participantes
  aplica o desconto enquanto estiver ativa e dentro do período
  (inicio_em/fim_em). Fora do período, o preço volta ao normal
  sozinho — ativação e desativação automáticas.
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
  Acrescenta preço promocional a produtos (listagens da loja):
    preco           preço efetivo (com desconto, se houver)
    preco_original  preço cheio, apenas quando há promoção
    promocao        { campanha, desconto_percentual }
*/
async function aplicarEmProdutos(produtos) {

  const descontos = await descontosVigentes(produtos.map(p => p.id));

  return produtos.map(produto => {

    const promocao = descontos.get(produto.id);

    if (!promocao) {
      return { ...produto, preco_original: null, promocao: null };
    }

    return {
      ...produto,
      preco: precoComDesconto(produto.preco, promocao.desconto_percentual),
      preco_original: Number(produto.preco),
      promocao: {
        campanha_id: promocao.campanha_id,
        campanha: promocao.campanha_titulo,
        desconto_percentual: Number(promocao.desconto_percentual)
      }
    };
  });
}


module.exports = {
  CAMPANHA_VIGENTE,
  descontosVigentes,
  precoComDesconto,
  aplicarEmProdutos
};
