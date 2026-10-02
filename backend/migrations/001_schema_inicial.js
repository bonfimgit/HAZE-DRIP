/*
  Schema do MVP, reconstruído a partir das consultas da API.

  Usa CREATE TABLE IF NOT EXISTS: em um banco que já tem
  essas tabelas (produção), esta migração não altera nada.
  Em um banco vazio (desenvolvimento/testes), cria tudo.
*/

module.exports = {

  descricao: 'Schema inicial do MVP',

  async up(conexao) {

    await conexao.query(`
      CREATE TABLE IF NOT EXISTS categorias (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nome VARCHAR(100) NOT NULL,
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_categorias_nome (nome)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conexao.query(`
      CREATE TABLE IF NOT EXISTS produtos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nome VARCHAR(150) NOT NULL,
        descricao TEXT NULL,
        preco DECIMAL(10,2) NOT NULL,
        categoria_id INT NOT NULL,
        ativo BOOLEAN NOT NULL DEFAULT FALSE,
        destaque_home BOOLEAN NOT NULL DEFAULT FALSE,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_produtos_categoria
          FOREIGN KEY (categoria_id) REFERENCES categorias (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conexao.query(`
      CREATE TABLE IF NOT EXISTS produto_imagens (
        id INT AUTO_INCREMENT PRIMARY KEY,
        produto_id INT NOT NULL,
        url VARCHAR(500) NOT NULL,
        cloudinary_public_id VARCHAR(255) NULL,
        principal BOOLEAN NOT NULL DEFAULT FALSE,
        ordem INT NOT NULL DEFAULT 0,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_imagens_produto
          FOREIGN KEY (produto_id) REFERENCES produtos (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conexao.query(`
      CREATE TABLE IF NOT EXISTS produto_variacoes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        produto_id INT NOT NULL,
        tamanho VARCHAR(20) NOT NULL,
        cor VARCHAR(50) NOT NULL,
        estoque INT NOT NULL DEFAULT 0,
        sku VARCHAR(80) NOT NULL,
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_variacoes_sku (sku),
        UNIQUE KEY uq_produto_tamanho_cor (produto_id, tamanho, cor),
        CONSTRAINT fk_variacoes_produto
          FOREIGN KEY (produto_id) REFERENCES produtos (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conexao.query(`
      CREATE TABLE IF NOT EXISTS campanhas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        titulo VARCHAR(150) NOT NULL,
        subtitulo VARCHAR(500) NULL,
        imagem_url VARCHAR(500) NOT NULL,
        cloudinary_public_id VARCHAR(255) NULL,
        texto_botao VARCHAR(60) NULL,
        link_botao VARCHAR(255) NULL,
        ativo BOOLEAN NOT NULL DEFAULT FALSE,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conexao.query(`
      CREATE TABLE IF NOT EXISTS usuarios_admin (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nome VARCHAR(100) NOT NULL,
        email VARCHAR(150) NOT NULL,
        senha_hash VARCHAR(255) NOT NULL,
        perfil VARCHAR(30) NOT NULL DEFAULT 'gerente',
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_usuarios_admin_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conexao.query(`
      CREATE TABLE IF NOT EXISTS pedidos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        status VARCHAR(30) NOT NULL DEFAULT 'aguardando_pagamento',
        cliente_nome VARCHAR(150) NOT NULL,
        cliente_email VARCHAR(150) NOT NULL,
        cliente_telefone VARCHAR(20) NOT NULL,
        endereco_cep VARCHAR(9) NOT NULL,
        endereco_rua VARCHAR(150) NOT NULL,
        endereco_numero VARCHAR(20) NOT NULL,
        endereco_complemento VARCHAR(100) NULL,
        endereco_bairro VARCHAR(100) NOT NULL,
        endereco_cidade VARCHAR(100) NOT NULL,
        endereco_estado CHAR(2) NOT NULL,
        subtotal DECIMAL(10,2) NOT NULL,
        frete DECIMAL(10,2) NOT NULL DEFAULT 0,
        total DECIMAL(10,2) NOT NULL,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conexao.query(`
      CREATE TABLE IF NOT EXISTS pedidos_itens (
        id INT AUTO_INCREMENT PRIMARY KEY,
        pedido_id INT NOT NULL,
        produto_id INT NOT NULL,
        variacao_id INT NOT NULL,
        produto_nome VARCHAR(150) NOT NULL,
        sku VARCHAR(80) NULL,
        cor VARCHAR(50) NULL,
        tamanho VARCHAR(20) NULL,
        preco_unitario DECIMAL(10,2) NOT NULL,
        quantidade INT NOT NULL,
        subtotal DECIMAL(10,2) NOT NULL,
        CONSTRAINT fk_itens_pedido
          FOREIGN KEY (pedido_id) REFERENCES pedidos (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }
};
