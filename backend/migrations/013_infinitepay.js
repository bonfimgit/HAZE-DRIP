module.exports = {

  descricao: 'Pagamentos pela InfinitePay (slug e order_nsu para confirmar a transação)',

  async up(conexao, { adicionarColuna }) {

    /*
      A InfinitePay confirma um pagamento com três dados: order_nsu
      (gerado pela loja para cada link), transaction_nsu (provedor_id)
      e slug (código da fatura). Guardados para o painel e a expiração
      poderem conferir o pagamento de novo.
    */
    await adicionarColuna('pagamentos', 'order_nsu', 'VARCHAR(80) NULL');
    await adicionarColuna('pagamentos', 'slug', 'VARCHAR(120) NULL');
  }
};
