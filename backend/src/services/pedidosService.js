const db = require('../config/db');
const { emTransacao } = require('../utils/transacao');
const {
  ErroApp,
  naoEncontrado,
  conflito,
  requisicaoInvalida
} = require('../utils/erros');
const { arredondar } = require('../utils/dinheiro');
const { publicar } = require('../utils/eventos');
const estoqueService = require('./estoqueService');


const STATUS = [
  'aguardando_pagamento',
  'pago',
  'em_preparacao',
  'enviado',
  'entregue',
  'cancelado'
];

// Fluxo permitido: cada status só avança para o próximo
const PROXIMO_STATUS = {
  aguardando_pagamento: 'pago',
  pago: 'em_preparacao',
  em_preparacao: 'enviado',
  enviado: 'entregue'
};

const STATUS_CANCELAVEIS = [
  'aguardando_pagamento',
  'pago',
  'em_preparacao'
];

// Coluna de data preenchida quando o pedido entra em cada status
const COLUNA_DATA_STATUS = {
  pago: 'pago_em',
  enviado: 'enviado_em',
  entregue: 'entregue_em',
  cancelado: 'cancelado_em'
};

const MAX_ITENS = 50;
const MAX_QUANTIDADE_ITEM = 99;


async function registrarHistorico(conexao, {
  pedidoId,
  statusAnterior,
  statusNovo,
  observacao = null,
  adminId = null,
  origem = 'sistema'
}) {

  await conexao.execute(
    `INSERT INTO pedido_status_historico
      (pedido_id, status_anterior, status_novo, observacao, admin_id, origem)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [pedidoId, statusAnterior, statusNovo, observacao, adminId, origem]
  );
}


/*
  Agrupa itens repetidos da mesma variação e valida quantidades.
  Sem o agrupamento, duas linhas da mesma variação passariam na
  validação separadamente e o estoque poderia ficar negativo.
*/
function normalizarItens(itens) {

  if (!Array.isArray(itens) || itens.length === 0) {
    throw requisicaoInvalida('O pedido precisa possuir pelo menos um item');
  }

  if (itens.length > MAX_ITENS) {
    throw requisicaoInvalida('O pedido possui itens demais');
  }

  const agrupados = new Map();

  for (const item of itens) {

    const produtoId = Number(item?.produto_id);
    const variacaoId = Number(item?.variacao_id);
    const quantidade = Number(item?.quantidade);

    if (
      !Number.isInteger(produtoId) || produtoId <= 0 ||
      !Number.isInteger(variacaoId) || variacaoId <= 0 ||
      !Number.isInteger(quantidade) || quantidade <= 0
    ) {
      throw requisicaoInvalida('Item do pedido inválido');
    }

    const existente = agrupados.get(variacaoId);

    if (existente) {

      if (existente.produtoId !== produtoId) {
        throw requisicaoInvalida('Item do pedido inválido');
      }

      existente.quantidade += quantidade;

    } else {

      agrupados.set(variacaoId, { produtoId, variacaoId, quantidade });
    }
  }

  const resultado = [...agrupados.values()];

  if (resultado.some(item => item.quantidade > MAX_QUANTIDADE_ITEM)) {
    throw requisicaoInvalida('Quantidade máxima por item excedida');
  }

  // Ordem fixa: pedidos simultâneos travam as linhas na mesma ordem
  return resultado.sort((a, b) => a.variacaoId - b.variacaoId);
}


/*
  Trava as variações (FOR UPDATE) e confere disponibilidade.
  Devolve os itens com nome, preço e subtotal vindos do banco.
*/
async function validarItensNoBanco(conexao, itens) {

  const validados = [];

  for (const item of itens) {

    const [linhas] = await conexao.query(
      `SELECT
          v.id AS variacao_id,
          v.produto_id,
          v.tamanho,
          v.cor,
          v.estoque,
          v.sku,
          v.ativo AS variacao_ativa,
          p.nome AS produto_nome,
          p.preco,
          p.ativo AS produto_ativo
       FROM produto_variacoes v
       INNER JOIN produtos p
         ON p.id = v.produto_id
       WHERE v.id = ?
       AND v.produto_id = ?
       FOR UPDATE`,
      [item.variacaoId, item.produtoId]
    );

    if (linhas.length === 0) {
      throw naoEncontrado('Produto ou variação não encontrada');
    }

    const produto = linhas[0];

    if (!Number(produto.produto_ativo) || !Number(produto.variacao_ativa)) {
      throw requisicaoInvalida(`${produto.produto_nome} não está disponível`);
    }

    if (item.quantidade > Number(produto.estoque)) {
      throw conflito(
        `Estoque insuficiente para ${produto.produto_nome} - ${produto.cor} / ${produto.tamanho}`
      );
    }

    const precoUnitario = Number(produto.preco);

    validados.push({
      produto_id: produto.produto_id,
      variacao_id: produto.variacao_id,
      produto_nome: produto.produto_nome,
      sku: produto.sku,
      cor: produto.cor,
      tamanho: produto.tamanho,
      preco_unitario: precoUnitario,
      quantidade: item.quantidade,
      estoque: Number(produto.estoque),
      subtotal: arredondar(precoUnitario * item.quantidade)
    });
  }

  return validados;
}


/*
  Cria o pedido, os itens e baixa o estoque em uma transação.

  "ajustes" permite que o checkout acrescente frete, desconto e
  outros campos sem alterar esta função:
    calcular(conexao, itensValidados) => {
      frete, desconto, colunas: { coluna: valor }, aposCriar(conexao, pedidoId)
    }
*/
async function criar({ cliente, endereco, itens, clienteId = null, ajustes = null }) {

  const itensNormalizados = normalizarItens(itens);

  const pedido = await emTransacao(async conexao => {

    const itensValidados = await validarItensNoBanco(conexao, itensNormalizados);

    const subtotal = arredondar(
      itensValidados.reduce((total, item) => total + item.subtotal, 0)
    );

    const extras = ajustes
      ? await ajustes.calcular(conexao, itensValidados, subtotal)
      : {};

    const frete = arredondar(extras.frete || 0);
    const desconto = arredondar(Math.min(extras.desconto || 0, subtotal));
    const total = arredondar(subtotal - desconto + frete);

    const colunas = {
      status: 'aguardando_pagamento',
      cliente_nome: cliente.nome,
      cliente_email: cliente.email,
      cliente_telefone: cliente.telefone,
      endereco_cep: endereco.cep,
      endereco_rua: endereco.rua,
      endereco_numero: endereco.numero,
      endereco_complemento: endereco.complemento,
      endereco_bairro: endereco.bairro,
      endereco_cidade: endereco.cidade,
      endereco_estado: endereco.estado,
      subtotal,
      frete,
      total,
      ...(clienteId ? { cliente_id: clienteId } : {}),
      ...(extras.colunas || {})
    };

    const nomes = Object.keys(colunas);

    const [resultado] = await conexao.query(
      `INSERT INTO pedidos (${nomes.map(nome => `\`${nome}\``).join(', ')})
       VALUES (${nomes.map(() => '?').join(', ')})`,
      nomes.map(nome => colunas[nome])
    );

    const pedidoId = resultado.insertId;

    for (const item of itensValidados) {

      await conexao.query(
        `INSERT INTO pedidos_itens
          (pedido_id, produto_id, variacao_id, produto_nome, sku,
           cor, tamanho, preco_unitario, quantidade, subtotal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pedidoId,
          item.produto_id,
          item.variacao_id,
          item.produto_nome,
          item.sku,
          item.cor,
          item.tamanho,
          item.preco_unitario,
          item.quantidade,
          item.subtotal
        ]
      );

      // "estoque >= ?" garante que o estoque nunca fique negativo
      const [baixa] = await conexao.query(
        `UPDATE produto_variacoes
         SET estoque = estoque - ?
         WHERE id = ?
         AND estoque >= ?`,
        [item.quantidade, item.variacao_id, item.quantidade]
      );

      if (baixa.affectedRows === 0) {
        throw conflito(
          `Estoque insuficiente para ${item.produto_nome} - ${item.cor} / ${item.tamanho}`
        );
      }

      await estoqueService.registrarMovimentacao(conexao, {
        variacaoId: item.variacao_id,
        tipo: 'venda',
        quantidade: -item.quantidade,
        estoqueAnterior: item.estoque,
        estoqueNovo: item.estoque - item.quantidade,
        motivo: `Pedido #${pedidoId}`,
        pedidoId
      });
    }

    await registrarHistorico(conexao, {
      pedidoId,
      statusAnterior: null,
      statusNovo: 'aguardando_pagamento',
      origem: 'loja'
    });

    // Pedido feito: esvazia o carrinho salvo do cliente
    if (clienteId) {
      await conexao.execute(
        'DELETE FROM carrinho_itens WHERE cliente_id = ?',
        [clienteId]
      );
    }

    if (extras.aposCriar) {
      await extras.aposCriar(conexao, pedidoId);
    }

    return {
      id: pedidoId,
      status: 'aguardando_pagamento',
      subtotal,
      desconto,
      frete,
      total
    };
  });

  publicar('pedido:criado', { pedidoId: pedido.id });

  return pedido;
}


/* =============================================================
   CONSULTAS
============================================================= */

const COLUNAS_RESUMO = `
  id,
  status,
  cliente_nome,
  cliente_email,
  cliente_telefone,
  subtotal,
  frete,
  total,
  criado_em
`;


async function listarAdmin({ status = null, busca = null, limite = 500, pagina = 1 } = {}) {

  const filtros = [];
  const valores = [];

  if (status) {
    filtros.push('status = ?');
    valores.push(status);
  }

  if (busca) {
    filtros.push('(cliente_nome LIKE ? OR cliente_email LIKE ? OR CAST(id AS CHAR) = ?)');
    valores.push(`%${busca}%`, `%${busca}%`, busca);
  }

  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';

  const [pedidos] = await db.query(
    `SELECT ${COLUNAS_RESUMO}
     FROM pedidos
     ${where}
     ORDER BY id DESC
     LIMIT ? OFFSET ?`,
    [...valores, limite, (pagina - 1) * limite]
  );

  return pedidos;
}


async function buscarCompleto(pedidoId, { clienteId = null } = {}) {

  const [pedidos] = await db.execute(
    'SELECT * FROM pedidos WHERE id = ?',
    [pedidoId]
  );

  if (pedidos.length === 0) {
    throw naoEncontrado('Pedido não encontrado');
  }

  const pedido = pedidos[0];

  // Cliente só pode ver os próprios pedidos
  if (clienteId !== null && pedido.cliente_id !== clienteId) {
    throw naoEncontrado('Pedido não encontrado');
  }

  const [itens] = await db.execute(
    `SELECT
        pedido_id,
        produto_id,
        variacao_id,
        produto_nome,
        sku,
        cor,
        tamanho,
        preco_unitario,
        quantidade,
        subtotal
     FROM pedidos_itens
     WHERE pedido_id = ?
     ORDER BY id ASC`,
    [pedidoId]
  );

  const [historico] = await db.execute(
    `SELECT
        h.status_anterior,
        h.status_novo,
        h.observacao,
        h.origem,
        h.criado_em,
        a.nome AS admin_nome
     FROM pedido_status_historico h
     LEFT JOIN usuarios_admin a ON a.id = h.admin_id
     WHERE h.pedido_id = ?
     ORDER BY h.criado_em ASC, h.id ASC`,
    [pedidoId]
  );

  return {
    ...pedido,
    itens,
    historico
  };
}


async function listarDoCliente(clienteId) {

  const [pedidos] = await db.execute(
    `SELECT
        p.id,
        p.status,
        p.subtotal,
        p.frete,
        p.total,
        p.criado_em,
        p.codigo_rastreio,
        (
          SELECT COALESCE(SUM(i.quantidade), 0)
          FROM pedidos_itens i
          WHERE i.pedido_id = p.id
        ) AS quantidade_itens
     FROM pedidos p
     WHERE p.cliente_id = ?
     ORDER BY p.id DESC`,
    [clienteId]
  );

  return pedidos;
}


/* =============================================================
   STATUS
============================================================= */

async function avancarStatus(pedidoId, statusNovo, {
  adminId = null,
  origem = 'admin',
  observacao = null,
  rastreio = null
} = {}) {

  const resultado = await emTransacao(async conexao => {

    const [pedidos] = await conexao.execute(
      'SELECT id, status FROM pedidos WHERE id = ? FOR UPDATE',
      [pedidoId]
    );

    if (pedidos.length === 0) {
      throw naoEncontrado('Pedido não encontrado');
    }

    const statusAtual = pedidos[0].status;

    if (statusAtual === 'entregue') {
      throw conflito('Pedido entregue não pode ter o status alterado');
    }

    if (statusAtual === 'cancelado') {
      throw conflito('Pedido cancelado não pode ter o status alterado');
    }

    const esperado = PROXIMO_STATUS[statusAtual];

    if (statusNovo !== esperado) {
      throw conflito(
        `Alteração inválida. O próximo status deve ser: ${esperado}`
      );
    }

    const sets = ['status = ?'];
    const valores = [statusNovo];

    if (COLUNA_DATA_STATUS[statusNovo]) {
      sets.push(`${COLUNA_DATA_STATUS[statusNovo]} = NOW()`);
    }

    if (rastreio) {
      sets.push('codigo_rastreio = ?', 'transportadora = ?', 'url_rastreio = ?');
      valores.push(rastreio.codigo, rastreio.transportadora, rastreio.url);
    }

    await conexao.execute(
      `UPDATE pedidos SET ${sets.join(', ')} WHERE id = ?`,
      [...valores, pedidoId]
    );

    await registrarHistorico(conexao, {
      pedidoId,
      statusAnterior: statusAtual,
      statusNovo,
      observacao,
      adminId,
      origem
    });

    return { id: pedidoId, status: statusNovo, statusAnterior: statusAtual };
  });

  publicar('pedido:status', {
    pedidoId,
    status: statusNovo,
    statusAnterior: resultado.statusAnterior
  });

  return { id: resultado.id, status: resultado.status };
}


async function atualizarRastreio(pedidoId, { codigo, transportadora, url }) {

  const [resultado] = await db.execute(
    `UPDATE pedidos
     SET codigo_rastreio = ?, transportadora = ?, url_rastreio = ?
     WHERE id = ?`,
    [codigo, transportadora, url, pedidoId]
  );

  if (resultado.affectedRows === 0) {
    throw naoEncontrado('Pedido não encontrado');
  }
}


/*
  Cancela o pedido e devolve o estoque.
  Usado pelo admin, pela expiração de pagamento e pelo webhook.
*/
async function cancelar(pedidoId, {
  adminId = null,
  origem = 'admin',
  motivo = null,
  conexaoExterna = null
} = {}) {

  const executar = async conexao => {

    const [pedidos] = await conexao.execute(
      'SELECT id, status FROM pedidos WHERE id = ? FOR UPDATE',
      [pedidoId]
    );

    if (pedidos.length === 0) {
      throw naoEncontrado('Pedido não encontrado');
    }

    const statusAtual = pedidos[0].status;

    if (statusAtual === 'cancelado') {
      throw conflito('Pedido já está cancelado');
    }

    if (!STATUS_CANCELAVEIS.includes(statusAtual)) {
      throw conflito('Este pedido não pode mais ser cancelado');
    }

    const [itens] = await conexao.execute(
      `SELECT variacao_id, quantidade
       FROM pedidos_itens
       WHERE pedido_id = ?
       ORDER BY variacao_id ASC`,
      [pedidoId]
    );

    for (const item of itens) {

      const [variacoes] = await conexao.execute(
        'SELECT estoque FROM produto_variacoes WHERE id = ? FOR UPDATE',
        [item.variacao_id]
      );

      if (variacoes.length === 0) {
        throw new ErroApp(500, `Variação ${item.variacao_id} não encontrada`);
      }

      const anterior = Number(variacoes[0].estoque);

      await conexao.execute(
        'UPDATE produto_variacoes SET estoque = estoque + ? WHERE id = ?',
        [item.quantidade, item.variacao_id]
      );

      await estoqueService.registrarMovimentacao(conexao, {
        variacaoId: item.variacao_id,
        tipo: 'cancelamento',
        quantidade: item.quantidade,
        estoqueAnterior: anterior,
        estoqueNovo: anterior + item.quantidade,
        motivo: `Cancelamento do pedido #${pedidoId}`,
        pedidoId,
        adminId
      });
    }

    await conexao.execute(
      `UPDATE pedidos
       SET status = 'cancelado',
           cancelado_em = NOW(),
           motivo_cancelamento = ?
       WHERE id = ?`,
      [motivo, pedidoId]
    );

    await registrarHistorico(conexao, {
      pedidoId,
      statusAnterior: statusAtual,
      statusNovo: 'cancelado',
      observacao: motivo,
      adminId,
      origem
    });

    return statusAtual;
  };

  const statusAnterior = conexaoExterna
    ? await executar(conexaoExterna)
    : await emTransacao(executar);

  publicar('pedido:status', {
    pedidoId,
    status: 'cancelado',
    statusAnterior
  });

  return { id: pedidoId, status: 'cancelado' };
}


module.exports = {
  STATUS,
  PROXIMO_STATUS,
  STATUS_CANCELAVEIS,
  registrarHistorico,
  criar,
  listarAdmin,
  buscarCompleto,
  listarDoCliente,
  avancarStatus,
  atualizarRastreio,
  cancelar
};
