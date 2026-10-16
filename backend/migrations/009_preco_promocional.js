module.exports = {

  descricao: 'Preço promocional por produto ("de/por")',

  async up(conexao, { adicionarColuna }) {

    // Preço "por" definido no próprio produto; NULL = sem promoção
    await adicionarColuna('produtos', 'preco_promocional', 'DECIMAL(10,2) NULL AFTER preco');
  }
};
