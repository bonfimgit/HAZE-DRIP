module.exports = {

  descricao: 'Histórico de status, rastreio e datas dos pedidos',

  async up(conexao, { adicionarColuna, adicionarIndice }) {

    await adicionarColuna('pedidos', 'criado_em',
      'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP');

    await adicionarColuna('pedidos', 'atualizado_em',
      'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');

    await adicionarColuna('pedidos', 'codigo_rastreio', 'VARCHAR(60) NULL');
    await adicionarColuna('pedidos', 'transportadora', 'VARCHAR(60) NULL');
    await adicionarColuna('pedidos', 'url_rastreio', 'VARCHAR(255) NULL');

    await adicionarColuna('pedidos', 'pago_em', 'DATETIME NULL');
    await adicionarColuna('pedidos', 'enviado_em', 'DATETIME NULL');
    await adicionarColuna('pedidos', 'entregue_em', 'DATETIME NULL');
    await adicionarColuna('pedidos', 'cancelado_em', 'DATETIME NULL');
    await adicionarColuna('pedidos', 'motivo_cancelamento', 'VARCHAR(255) NULL');

    await adicionarIndice('pedidos', 'idx_pedidos_status',
      'INDEX idx_pedidos_status (status)');

    await adicionarIndice('pedidos', 'idx_pedidos_email',
      'INDEX idx_pedidos_email (cliente_email)');

    await adicionarIndice('pedidos', 'idx_pedidos_criado_em',
      'INDEX idx_pedidos_criado_em (criado_em)');

    await conexao.query(`
      CREATE TABLE IF NOT EXISTS pedido_status_historico (
        id INT AUTO_INCREMENT PRIMARY KEY,
        pedido_id INT NOT NULL,
        status_anterior VARCHAR(30) NULL,
        status_novo VARCHAR(30) NOT NULL,
        observacao VARCHAR(255) NULL,
        admin_id INT NULL,
        origem VARCHAR(30) NOT NULL DEFAULT 'sistema',
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_historico_pedido (pedido_id, criado_em),
        CONSTRAINT fk_historico_pedido
          FOREIGN KEY (pedido_id) REFERENCES pedidos (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }
};
