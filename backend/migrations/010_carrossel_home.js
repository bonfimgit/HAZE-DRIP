module.exports = {

  descricao: 'Produto no carrossel da Home (separado do destaque)',

  async up(conexao, { adicionarColuna }) {

    // Foto principal do produto entra no banner da Home
    await adicionarColuna('produtos', 'carrossel_home', 'BOOLEAN NOT NULL DEFAULT FALSE AFTER destaque_home');
  }
};
