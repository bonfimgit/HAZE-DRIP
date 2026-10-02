module.exports = {

  descricao: 'Clientes, endereços, sessões, tokens e carrinho',

  async up(conexao, { adicionarColuna, adicionarIndice }) {

    await conexao.query(`
      CREATE TABLE IF NOT EXISTS clientes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nome VARCHAR(150) NOT NULL,
        email VARCHAR(150) NOT NULL,
        telefone VARCHAR(20) NULL,
        senha_hash VARCHAR(255) NOT NULL,
        email_verificado_em DATETIME NULL,
        bloqueado BOOLEAN NOT NULL DEFAULT FALSE,
        motivo_bloqueio VARCHAR(255) NULL,
        token_versao INT NOT NULL DEFAULT 0,
        ultimo_login_em DATETIME NULL,
        excluido_em DATETIME NULL,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_clientes_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conexao.query(`
      CREATE TABLE IF NOT EXISTS cliente_enderecos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        cliente_id INT NOT NULL,
        apelido VARCHAR(50) NULL,
        destinatario VARCHAR(150) NULL,
        cep VARCHAR(9) NOT NULL,
        rua VARCHAR(150) NOT NULL,
        numero VARCHAR(20) NOT NULL,
        complemento VARCHAR(100) NULL,
        bairro VARCHAR(100) NOT NULL,
        cidade VARCHAR(100) NOT NULL,
        estado CHAR(2) NOT NULL,
        principal BOOLEAN NOT NULL DEFAULT FALSE,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_enderecos_cliente (cliente_id),
        CONSTRAINT fk_enderecos_cliente
          FOREIGN KEY (cliente_id) REFERENCES clientes (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Refresh tokens (armazenados como hash)
    await conexao.query(`
      CREATE TABLE IF NOT EXISTS cliente_sessoes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        cliente_id INT NOT NULL,
        token_hash CHAR(64) NOT NULL,
        expira_em DATETIME NOT NULL,
        revogado_em DATETIME NULL,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_sessoes_token (token_hash),
        KEY idx_sessoes_cliente (cliente_id),
        CONSTRAINT fk_sessoes_cliente
          FOREIGN KEY (cliente_id) REFERENCES clientes (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Tokens de uso único: recuperação de senha e verificação de e-mail
    await conexao.query(`
      CREATE TABLE IF NOT EXISTS cliente_tokens (
        id INT AUTO_INCREMENT PRIMARY KEY,
        cliente_id INT NOT NULL,
        tipo VARCHAR(30) NOT NULL,
        token_hash CHAR(64) NOT NULL,
        expira_em DATETIME NOT NULL,
        usado_em DATETIME NULL,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_cliente_tokens_hash (token_hash),
        KEY idx_cliente_tokens_cliente (cliente_id, tipo),
        CONSTRAINT fk_tokens_cliente
          FOREIGN KEY (cliente_id) REFERENCES clientes (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conexao.query(`
      CREATE TABLE IF NOT EXISTS carrinho_itens (
        cliente_id INT NOT NULL,
        variacao_id INT NOT NULL,
        quantidade INT NOT NULL,
        atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (cliente_id, variacao_id),
        CONSTRAINT fk_carrinho_cliente
          FOREIGN KEY (cliente_id) REFERENCES clientes (id) ON DELETE CASCADE,
        CONSTRAINT fk_carrinho_variacao
          FOREIGN KEY (variacao_id) REFERENCES produto_variacoes (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await adicionarColuna('pedidos', 'cliente_id', 'INT NULL');

    await adicionarIndice('pedidos', 'idx_pedidos_cliente',
      'INDEX idx_pedidos_cliente (cliente_id)');
  }
};
