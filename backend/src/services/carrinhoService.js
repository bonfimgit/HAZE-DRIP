const db = require('../config/db');
const { emTransacao } = require('../utils/transacao');
const { requisicaoInvalida } = require('../utils/erros');
const { arredondar } = require('../utils/dinheiro');
const promocoesService = require('./promocoesService');

const MAX_ITENS = 50;
const MAX_QUANTIDADE = 99;


/*
  Normaliza [{ variacao_id, quantidade }], somando repetidos.
*/
function normalizar(itens) {

  if (!Array.isArray(itens)) {
    throw requisicaoInvalida('Itens do carrinho inválidos');
  }

  if (itens.length > MAX_ITENS) {
    throw requisicaoInvalida('O carrinho possui itens demais');
  }

  const mapa = new Map();

  for (const item of itens) {

    const variacaoId = Number(item?.variacao_id);
    const quantidade = Number(item?.quantidade);

    if (
      !Number.isInteger(variacaoId) || variacaoId <= 0 ||
      !Number.isInteger(quantidade) || quantidade <= 0
    ) {
      throw requisicaoInvalida('Item do carrinho inválido');
    }

    mapa.set(variacaoId, Math.min((mapa.get(variacaoId) || 0) + quantidade, MAX_QUANTIDADE));
  }

  return [...mapa].map(([variacaoId, quantidade]) => ({ variacaoId, quantidade }));
}


/*
  Confere cada item no banco e devolve os dados atuais.
  Usado antes do checkout e para atualizar a sacola quando
  preço ou estoque mudam.

  Cada item recebe:
    disponivel  false se produto/variação inativos ou sem estoque
    ajustado    true se a quantidade foi reduzida ao estoque atual
    aviso       texto explicando o problema, quando houver
*/
async function validar(itens) {

  const normalizados = normalizar(itens);

  if (normalizados.length === 0) {
    return { itens: [], subtotal: 0, valido: true };
  }

  const ids = normalizados.map(item => item.variacaoId);

  const [linhas] = await db.query(
    `SELECT
        v.id AS variacao_id,
        v.produto_id,
        v.cor,
        v.tamanho,
        v.estoque,
        v.ativo AS variacao_ativa,
        p.nome,
        p.preco,
        p.ativo AS produto_ativo,
        (
          SELECT pi.url
          FROM produto_imagens pi
          WHERE pi.produto_id = p.id
          AND pi.principal = TRUE
          LIMIT 1
        ) AS imagem
     FROM produto_variacoes v
     INNER JOIN produtos p ON p.id = v.produto_id
     WHERE v.id IN (?)`,
    [ids]
  );

  const porId = new Map(linhas.map(linha => [linha.variacao_id, linha]));

  const descontos = await promocoesService.descontosVigentes(
    linhas.map(linha => linha.produto_id)
  );

  const resultado = [];

  for (const { variacaoId, quantidade } of normalizados) {

    const linha = porId.get(variacaoId);

    if (!linha) {
      resultado.push({
        variacao_id: variacaoId,
        quantidade,
        disponivel: false,
        aviso: 'Produto não encontrado'
      });
      continue;
    }

    const estoque = Number(linha.estoque);
    const ativo = Number(linha.produto_ativo) && Number(linha.variacao_ativa);

    let aviso = null;
    let disponivel = true;
    let quantidadeFinal = quantidade;

    if (!ativo) {
      disponivel = false;
      aviso = 'Produto indisponível';
    } else if (estoque <= 0) {
      disponivel = false;
      aviso = 'Produto esgotado';
    } else if (quantidade > estoque) {
      quantidadeFinal = estoque;
      aviso = `Só restam ${estoque} unidade(s). A quantidade foi ajustada.`;
    }

    const promocao = descontos.get(linha.produto_id);

    const preco = promocao
      ? promocoesService.precoComDesconto(linha.preco, promocao.desconto_percentual)
      : Number(linha.preco);

    resultado.push({
      variacao_id: variacaoId,
      produto_id: linha.produto_id,
      nome: linha.nome,
      cor: linha.cor,
      tamanho: linha.tamanho,
      preco,
      preco_original: promocao ? Number(linha.preco) : null,
      imagem: linha.imagem,
      estoque,
      quantidade: quantidadeFinal,
      quantidade_solicitada: quantidade,
      subtotal: disponivel ? arredondar(preco * quantidadeFinal) : 0,
      disponivel,
      ajustado: quantidadeFinal !== quantidade,
      aviso
    });
  }

  const subtotal = arredondar(
    resultado.reduce((total, item) => total + (item.subtotal || 0), 0)
  );

  return {
    itens: resultado,
    subtotal,
    valido: resultado.every(item => item.disponivel && !item.ajustado)
  };
}


async function itensSalvos(clienteId) {

  const [itens] = await db.execute(
    `SELECT variacao_id, quantidade
     FROM carrinho_itens
     WHERE cliente_id = ?
     ORDER BY atualizado_em ASC`,
    [clienteId]
  );

  return itens;
}


async function obter(clienteId) {
  return validar(await itensSalvos(clienteId));
}


/*
  Salva o carrinho do cliente.
  mesclar = true soma com o que já estava salvo (usado no login,
  para juntar a sacola do visitante com a da conta).
*/
async function salvar(clienteId, itens, { mesclar = false } = {}) {

  let lista = itens;

  if (mesclar) {
    lista = [...(await itensSalvos(clienteId)), ...itens];
  }

  const normalizados = normalizar(lista);

  // Só guarda variações que existem
  let existentes = new Set();

  if (normalizados.length) {
    const [linhas] = await db.query(
      'SELECT id FROM produto_variacoes WHERE id IN (?)',
      [normalizados.map(item => item.variacaoId)]
    );
    existentes = new Set(linhas.map(linha => linha.id));
  }

  await emTransacao(async conexao => {

    await conexao.execute(
      'DELETE FROM carrinho_itens WHERE cliente_id = ?',
      [clienteId]
    );

    for (const item of normalizados) {

      if (!existentes.has(item.variacaoId)) {
        continue;
      }

      await conexao.execute(
        `INSERT INTO carrinho_itens (cliente_id, variacao_id, quantidade)
         VALUES (?, ?, ?)`,
        [clienteId, item.variacaoId, item.quantidade]
      );
    }
  });

  return obter(clienteId);
}


async function limpar(clienteId, conexao = db) {
  await conexao.execute(
    'DELETE FROM carrinho_itens WHERE cliente_id = ?',
    [clienteId]
  );
}


module.exports = {
  validar,
  obter,
  salvar,
  limpar
};
