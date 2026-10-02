/*
  Checkout completo: cotação (frete, cupom, totais) e finalização
  (pedido + pagamento), com proteção contra pedidos duplicados.
*/

const crypto = require('crypto');

const db = require('../config/db');
const { requisicaoInvalida, conflito } = require('../utils/erros');
const { arredondar } = require('../utils/dinheiro');
const { publicar } = require('../utils/eventos');
const logger = require('../utils/logger');
const carrinhoService = require('./carrinhoService');
const freteService = require('./freteService');
const cuponsService = require('./cuponsService');
const pedidosService = require('./pedidosService');
const pagamentosService = require('./pagamentosService');


/*
  Cotação para o resumo do checkout. Não reserva estoque nem cupom.
  Erros de cupom/frete voltam como aviso, para a tela continuar útil.
*/
async function cotar({ itens, cep, uf, cupom, clienteId = null, email = null }) {

  const carrinho = await carrinhoService.validar(itens);
  const subtotal = carrinho.subtotal;

  const resultado = {
    itens: carrinho.itens,
    carrinho_valido: carrinho.valido,
    subtotal,
    desconto: 0,
    frete: null,
    total: subtotal,
    cupom: null,
    erro_cupom: null,
    erro_frete: null
  };

  let cupomAplicado = null;

  if (cupom) {
    try {
      cupomAplicado = await cuponsService.aplicar({
        codigo: cupom,
        subtotal,
        clienteId,
        clienteEmail: email
      });
      resultado.cupom = cupomAplicado;
      resultado.desconto = cupomAplicado.desconto;
    } catch (erro) {
      resultado.erro_cupom = erro.message;
    }
  }

  if (cep) {
    try {
      resultado.frete = await freteService.calcular({
        cep,
        uf,
        valorProdutos: subtotal - resultado.desconto,
        freteGratisCupom: Boolean(cupomAplicado?.frete_gratis)
      });
    } catch (erro) {
      resultado.erro_frete = erro.message;
    }
  }

  resultado.total = arredondar(subtotal - resultado.desconto + (resultado.frete?.valor || 0));

  return resultado;
}


async function buscarPorChave(chave, email) {

  const [pedidos] = await db.execute(
    `SELECT id, status, subtotal, desconto, frete, total, token_acesso, cliente_email
     FROM pedidos
     WHERE chave_idempotencia = ?`,
    [chave]
  );

  const pedido = pedidos[0];

  if (!pedido) {
    return null;
  }

  // A chave só devolve o pedido para quem o criou
  if (pedido.cliente_email !== email) {
    throw conflito('Não foi possível concluir o pedido. Recarregue a página e tente novamente.');
  }

  const { cliente_email: _, ...dados } = pedido;
  return dados;
}


/*
  Finaliza a compra.
  "chaveIdempotencia" é gerada pela página de checkout: se o cliente
  clicar duas vezes ou a conexão cair e ele tentar de novo, o mesmo
  pedido é devolvido em vez de criar outro.
*/
async function finalizar({ cliente, endereco, itens, clienteId, cupom, metodoPagamento, chaveIdempotencia }) {

  if (!pagamentosService.METODOS.includes(metodoPagamento)) {
    throw requisicaoInvalida('Escolha a forma de pagamento');
  }

  if (chaveIdempotencia) {

    const existente = await buscarPorChave(chaveIdempotencia, cliente.email);

    if (existente) {
      return {
        repetido: true,
        pedido: existente,
        pagamento: await pagamentosService.resumo(existente.id)
      };
    }
  }

  const tokenAcesso = crypto.randomBytes(32).toString('hex');

  let pedido;

  try {

    pedido = await pedidosService.criar({
      cliente,
      endereco,
      itens,
      clienteId,
      publicarEvento: false,
      ajustes: {

        async calcular(conexao, itensValidados, subtotal) {

          let cupomAplicado = null;

          if (cupom) {
            // Trava o cupom: pedidos simultâneos respeitam os limites
            cupomAplicado = await cuponsService.aplicar({
              codigo: cupom,
              subtotal,
              clienteId,
              clienteEmail: cliente.email,
              conexao,
              travar: true
            });
          }

          const desconto = cupomAplicado ? cupomAplicado.desconto : 0;

          const frete = await freteService.calcular({
            cep: endereco.cep,
            uf: endereco.estado,
            valorProdutos: subtotal - desconto,
            freteGratisCupom: Boolean(cupomAplicado?.frete_gratis),
            conexao
          });

          return {
            desconto,
            frete: frete.valor,
            colunas: {
              desconto,
              cupom_id: cupomAplicado ? cupomAplicado.id : null,
              cupom_codigo: cupomAplicado ? cupomAplicado.codigo : null,
              frete_descricao: frete.descricao,
              frete_prazo_min: frete.prazo_min_dias,
              frete_prazo_max: frete.prazo_max_dias,
              metodo_pagamento: metodoPagamento,
              chave_idempotencia: chaveIdempotencia || null,
              token_acesso: tokenAcesso
            },
            retorno: {
              token_acesso: tokenAcesso,
              frete_prazo_min: frete.prazo_min_dias,
              frete_prazo_max: frete.prazo_max_dias
            },
            async aposCriar(conexaoPedido, pedidoId) {
              if (cupomAplicado) {
                await cuponsService.registrarUso(conexaoPedido, {
                  cupomId: cupomAplicado.id,
                  pedidoId,
                  clienteId,
                  clienteEmail: cliente.email
                });
              }
            }
          };
        }
      }
    });

  } catch (erro) {

    // Duas requisições com a mesma chave ao mesmo tempo
    if (erro.code === 'ER_DUP_ENTRY' && chaveIdempotencia) {
      const existente = await buscarPorChave(chaveIdempotencia, cliente.email);
      if (existente) {
        return {
          repetido: true,
          pedido: existente,
          pagamento: await pagamentosService.resumo(existente.id)
        };
      }
    }

    throw erro;
  }

  // Pagamento é criado fora da transação do pedido (chamada externa)
  let pagamento = null;
  let erroPagamento = null;

  try {
    pagamento = await pagamentosService.iniciar(pedido.id, metodoPagamento);
  } catch (erro) {
    erroPagamento = 'Pedido registrado, mas não foi possível gerar o pagamento agora. Tente novamente pela página do pedido.';
    logger.erro('Erro ao iniciar pagamento', { pedidoId: pedido.id, erro: erro.message });
  }

  publicar('pedido:criado', { pedidoId: pedido.id });

  return {
    repetido: false,
    pedido,
    pagamento,
    erro_pagamento: erroPagamento
  };
}


module.exports = {
  cotar,
  finalizar
};
