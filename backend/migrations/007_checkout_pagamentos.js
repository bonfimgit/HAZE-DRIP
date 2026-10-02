module.exports = {

  descricao: 'Frete, cupons, promoções, pagamentos e idempotência do checkout',

  async up(conexao, { adicionarColuna, adicionarIndice }) {

    /* ---------- Frete ---------- */

    await conexao.query(`
      CREATE TABLE IF NOT EXISTS frete_regras (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nome VARCHAR(100) NOT NULL,
        uf CHAR(2) NULL,
        cep_inicio CHAR(8) NULL,
        cep_fim CHAR(8) NULL,
        valor DECIMAL(10,2) NOT NULL,
        prazo_min_dias INT NOT NULL,
        prazo_max_dias INT NOT NULL,
        gratis_acima DECIMAL(10,2) NULL,
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_frete_uf (uf)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Regra padrão para todo o Brasil (editável no painel)
    const [regras] = await conexao.query('SELECT COUNT(*) AS total FROM frete_regras');

    if (Number(regras[0].total) === 0) {
      await conexao.query(
        `INSERT INTO frete_regras
          (nome, uf, cep_inicio, cep_fim, valor, prazo_min_dias, prazo_max_dias, gratis_acima)
         VALUES ('Entrega padrão', NULL, NULL, NULL, 25.00, 5, 12, 399.00)`
      );
    }

    /* ---------- Cupons ---------- */

    await conexao.query(`
      CREATE TABLE IF NOT EXISTS cupons (
        id INT AUTO_INCREMENT PRIMARY KEY,
        codigo VARCHAR(40) NOT NULL,
        descricao VARCHAR(255) NULL,
        tipo VARCHAR(20) NOT NULL,
        valor DECIMAL(10,2) NOT NULL DEFAULT 0,
        valor_minimo DECIMAL(10,2) NULL,
        inicio_em DATETIME NULL,
        fim_em DATETIME NULL,
        limite_uso_total INT NULL,
        limite_por_cliente INT NULL,
        usos INT NOT NULL DEFAULT 0,
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_cupons_codigo (codigo)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conexao.query(`
      CREATE TABLE IF NOT EXISTS cupom_usos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        cupom_id INT NOT NULL,
        pedido_id INT NOT NULL,
        cliente_id INT NULL,
        cliente_email VARCHAR(150) NOT NULL,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_cupom_usos_pedido (pedido_id),
        KEY idx_cupom_usos_cupom (cupom_id, cliente_email),
        CONSTRAINT fk_cupom_usos_cupom
          FOREIGN KEY (cupom_id) REFERENCES cupons (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    /* ---------- Promoções (campanhas com período e desconto) ---------- */

    await adicionarColuna('campanhas', 'inicio_em', 'DATETIME NULL');
    await adicionarColuna('campanhas', 'fim_em', 'DATETIME NULL');
    await adicionarColuna('campanhas', 'desconto_percentual', 'DECIMAL(5,2) NULL');

    await conexao.query(`
      CREATE TABLE IF NOT EXISTS campanha_produtos (
        campanha_id INT NOT NULL,
        produto_id INT NOT NULL,
        PRIMARY KEY (campanha_id, produto_id),
        KEY idx_campanha_produtos_produto (produto_id),
        CONSTRAINT fk_campanha_produtos_campanha
          FOREIGN KEY (campanha_id) REFERENCES campanhas (id) ON DELETE CASCADE,
        CONSTRAINT fk_campanha_produtos_produto
          FOREIGN KEY (produto_id) REFERENCES produtos (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await adicionarColuna('pedidos_itens', 'preco_original', 'DECIMAL(10,2) NULL');

    /* ---------- Pedido: valores, frete, cupom, pagamento ---------- */

    await adicionarColuna('pedidos', 'desconto', 'DECIMAL(10,2) NOT NULL DEFAULT 0');
    await adicionarColuna('pedidos', 'cupom_id', 'INT NULL');
    await adicionarColuna('pedidos', 'cupom_codigo', 'VARCHAR(40) NULL');
    await adicionarColuna('pedidos', 'frete_descricao', 'VARCHAR(100) NULL');
    await adicionarColuna('pedidos', 'frete_prazo_min', 'INT NULL');
    await adicionarColuna('pedidos', 'frete_prazo_max', 'INT NULL');
    await adicionarColuna('pedidos', 'metodo_pagamento', 'VARCHAR(20) NULL');
    await adicionarColuna('pedidos', 'chave_idempotencia', 'VARCHAR(64) NULL');
    await adicionarColuna('pedidos', 'token_acesso', 'CHAR(64) NULL');
    await adicionarColuna('pedidos', 'pagamento_status', 'VARCHAR(30) NULL');
    await adicionarColuna('pedidos', 'pagamento_url', 'VARCHAR(500) NULL');
    await adicionarColuna('pedidos', 'pagamento_expira_em', 'DATETIME NULL');
    await adicionarColuna('pedidos', 'valor_reembolsado', 'DECIMAL(10,2) NOT NULL DEFAULT 0');
    await adicionarColuna('pedidos', 'reembolsado_em', 'DATETIME NULL');

    await adicionarIndice('pedidos', 'uq_pedidos_idempotencia',
      'UNIQUE INDEX uq_pedidos_idempotencia (chave_idempotencia)');

    await adicionarIndice('pedidos', 'idx_pedidos_expiracao',
      'INDEX idx_pedidos_expiracao (status, pagamento_expira_em)');

    /* ---------- Pagamentos ---------- */

    await conexao.query(`
      CREATE TABLE IF NOT EXISTS pagamentos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        pedido_id INT NOT NULL,
        provedor VARCHAR(30) NOT NULL,
        provedor_id VARCHAR(80) NULL,
        tipo VARCHAR(20) NOT NULL,
        metodo VARCHAR(40) NULL,
        status VARCHAR(30) NOT NULL,
        status_detalhe VARCHAR(80) NULL,
        valor DECIMAL(10,2) NOT NULL,
        valor_reembolsado DECIMAL(10,2) NOT NULL DEFAULT 0,
        pix_qr_code TEXT NULL,
        pix_qr_code_base64 MEDIUMTEXT NULL,
        url VARCHAR(500) NULL,
        expira_em DATETIME NULL,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_pagamentos_pedido (pedido_id),
        KEY idx_pagamentos_provedor (provedor, provedor_id),
        CONSTRAINT fk_pagamentos_pedido
          FOREIGN KEY (pedido_id) REFERENCES pedidos (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Registro dos webhooks recebidos (auditoria e diagnóstico)
    await conexao.query(`
      CREATE TABLE IF NOT EXISTS pagamento_eventos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        provedor VARCHAR(30) NOT NULL,
        tipo VARCHAR(50) NULL,
        recurso_id VARCHAR(80) NULL,
        assinatura_valida BOOLEAN NULL,
        resultado VARCHAR(255) NULL,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_pagamento_eventos_recurso (provedor, recurso_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }
};
