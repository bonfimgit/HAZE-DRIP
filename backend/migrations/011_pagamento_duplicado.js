module.exports = {

  descricao: 'Marca pagamentos em duplicidade (cliente pagou duas vezes o mesmo pedido)',

  async up(conexao, { adicionarColuna }) {

    /*
      Pagamento aprovado de um pedido que já estava pago por outro
      pagamento: precisa ser reembolsado e não pode, ao ser
      reembolsado, cancelar o pedido nem alterar o faturamento.
    */
    await adicionarColuna('pagamentos', 'duplicado', 'BOOLEAN NOT NULL DEFAULT FALSE');
  }
};
