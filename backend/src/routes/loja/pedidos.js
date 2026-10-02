const { Router } = require('express');

const valida = require('../../utils/validacao');
const { requisicaoInvalida } = require('../../utils/erros');
const pedidosService = require('../../services/pedidosService');

const router = Router();


/*
  Valida e normaliza cliente e endereço enviados pelo checkout.
  Exportada para ser reutilizada pelo checkout completo.
*/
function lerDadosEntrega(corpo) {

  const { cliente, endereco } = corpo || {};

  if (!cliente || typeof cliente !== 'object') {
    throw requisicaoInvalida('Dados do cliente são obrigatórios');
  }

  if (!endereco || typeof endereco !== 'object') {
    throw requisicaoInvalida('Endereço incompleto');
  }

  const obrigatorioCliente = 'Dados do cliente são obrigatórios';
  const obrigatorioEndereco = 'Endereço incompleto';

  return {

    cliente: {
      nome: valida.texto(cliente.nome, obrigatorioCliente, { max: 150 }),
      email: valida.email(cliente.email),
      telefone: valida.telefone(cliente.telefone)
    },

    endereco: {
      cep: valida.cep(endereco.cep),
      rua: valida.texto(endereco.rua, obrigatorioEndereco, { max: 150 }),
      numero: valida.texto(endereco.numero, obrigatorioEndereco, { max: 20 }),
      complemento: valida.texto(endereco.complemento, obrigatorioEndereco, { max: 100, opcional: true }),
      bairro: valida.texto(endereco.bairro, obrigatorioEndereco, { max: 100 }),
      cidade: valida.texto(endereco.cidade, obrigatorioEndereco, { max: 100 }),
      estado: valida.uf(endereco.estado)
    }
  };
}


router.post('/pedidos', async (req, res) => {

  const { cliente, endereco } = lerDadosEntrega(req.body);

  const pedido = await pedidosService.criar({
    cliente,
    endereco,
    itens: req.body.itens
  });

  res.status(201).json({
    mensagem: 'Pedido criado com sucesso',
    pedido
  });
});


module.exports = router;
module.exports.lerDadosEntrega = lerDadosEntrega;
