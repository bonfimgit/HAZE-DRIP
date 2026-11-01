const { Router } = require('express');

const valida = require('../../utils/validacao');
const { requisicaoInvalida } = require('../../utils/erros');
const enderecosService = require('../../services/enderecosService');

const router = Router();


function lerCliente(cliente) {

  if (!cliente || typeof cliente !== 'object') {
    throw requisicaoInvalida('Dados do cliente são obrigatórios');
  }

  return {
    nome: valida.texto(cliente.nome, 'Dados do cliente são obrigatórios', { max: 150 }),
    email: valida.email(cliente.email),
    telefone: valida.telefone(cliente.telefone)
  };
}


function lerEndereco(endereco) {

  if (!endereco || typeof endereco !== 'object') {
    throw requisicaoInvalida('Endereço incompleto');
  }

  const mensagem = 'Endereço incompleto';

  return {
    cep: valida.cep(endereco.cep),
    rua: valida.texto(endereco.rua, mensagem, { max: 150 }),
    numero: valida.texto(endereco.numero, mensagem, { max: 20 }),
    complemento: valida.texto(endereco.complemento, mensagem, { max: 100, opcional: true }),
    bairro: valida.texto(endereco.bairro, mensagem, { max: 100 }),
    cidade: valida.texto(endereco.cidade, mensagem, { max: 100 }),
    estado: valida.uf(endereco.estado)
  };
}


/*
  Lê cliente e endereço do checkout.
  Cliente logado pode enviar "endereco_id" de um endereço salvo.
*/
async function lerDadosEntrega(corpo, clienteLogado) {

  const dados = corpo || {};

  const cliente = lerCliente(dados.cliente);

  let endereco;

  if (dados.endereco_id != null && clienteLogado) {

    const salvo = await enderecosService.buscar(
      clienteLogado.id,
      valida.id(dados.endereco_id, 'Endereço inválido')
    );

    endereco = {
      cep: salvo.cep,
      rua: salvo.rua,
      numero: salvo.numero,
      complemento: salvo.complemento,
      bairro: salvo.bairro,
      cidade: salvo.cidade,
      estado: salvo.estado
    };

  } else {

    endereco = lerEndereco(dados.endereco);
  }

  return { cliente, endereco };
}


/*
  A antiga rota pública "POST /pedidos" foi removida.
  Ela criava pedidos sem pagamento, sem frete e sem prazo, o que
  permitia prender o estoque da loja indefinidamente. Todo pedido
  agora passa por "POST /checkout" (routes/loja/checkout.js).

  Este arquivo continua exportando os leitores de cliente/endereço,
  usados pelo checkout e pela área do cliente.
*/

module.exports = router;
module.exports.lerDadosEntrega = lerDadosEntrega;
module.exports.lerEndereco = lerEndereco;
