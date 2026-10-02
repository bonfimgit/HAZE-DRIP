module.exports = {

  descricao: 'Histórico de movimentações e estoque mínimo',

  async up(conexao, { adicionarColuna }) {

    await adicionarColuna(
      'produto_variacoes',
      'estoque_minimo',
      'INT NOT NULL DEFAULT 0'
    );

    await conexao.query(`
      CREATE TABLE IF NOT EXISTS estoque_movimentacoes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        variacao_id INT NOT NULL,
        tipo VARCHAR(20) NOT NULL,
        quantidade INT NOT NULL,
        estoque_anterior INT NOT NULL,
        estoque_novo INT NOT NULL,
        motivo VARCHAR(255) NULL,
        pedido_id INT NULL,
        admin_id INT NULL,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_movimentacoes_variacao (variacao_id, criado_em),
        KEY idx_movimentacoes_pedido (pedido_id),
        CONSTRAINT fk_movimentacoes_variacao
          FOREIGN KEY (variacao_id) REFERENCES produto_variacoes (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }
};
