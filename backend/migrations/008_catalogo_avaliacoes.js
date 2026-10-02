module.exports = {

  descricao: 'Avaliações de produtos e índices de desempenho do catálogo',

  async up(conexao, { adicionarIndice }) {

    await conexao.query(`
      CREATE TABLE IF NOT EXISTS avaliacoes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        produto_id INT NOT NULL,
        cliente_id INT NOT NULL,
        pedido_id INT NOT NULL,
        nota TINYINT NOT NULL,
        titulo VARCHAR(100) NULL,
        comentario TEXT NULL,
        visivel BOOLEAN NOT NULL DEFAULT TRUE,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_avaliacoes_cliente_produto (cliente_id, produto_id),
        KEY idx_avaliacoes_produto (produto_id, visivel, criado_em),
        CONSTRAINT fk_avaliacoes_produto
          FOREIGN KEY (produto_id) REFERENCES produtos (id) ON DELETE CASCADE,
        CONSTRAINT fk_avaliacoes_cliente
          FOREIGN KEY (cliente_id) REFERENCES clientes (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Catálogo: filtros por status/destaque e ordenação por data
    await adicionarIndice('produtos', 'idx_produtos_vitrine',
      'INDEX idx_produtos_vitrine (ativo, destaque_home, criado_em)');

    // Variações disponíveis por produto (filtros de tamanho/cor)
    await adicionarIndice('produto_variacoes', 'idx_variacoes_disponiveis',
      'INDEX idx_variacoes_disponiveis (produto_id, ativo, estoque)');

    // Imagem principal de cada produto (subconsulta das listagens)
    await adicionarIndice('produto_imagens', 'idx_imagens_principal',
      'INDEX idx_imagens_principal (produto_id, principal)');

    // Mais vendidos e relatórios por produto
    await adicionarIndice('pedidos_itens', 'idx_itens_produto',
      'INDEX idx_itens_produto (produto_id)');
  }
};
