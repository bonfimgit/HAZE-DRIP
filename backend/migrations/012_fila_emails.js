module.exports = {

  descricao: 'Fila de e-mails (envio com novas tentativas, sobrevive a reinícios)',

  async up(conexao) {

    /*
      Todo e-mail é gravado aqui antes do envio. Se o envio falhar ou
      o servidor reiniciar no meio, a fila tenta de novo depois.
      status: pendente → enviando → enviado | falhou
    */
    await conexao.query(`
      CREATE TABLE IF NOT EXISTS email_fila (
        id INT AUTO_INCREMENT PRIMARY KEY,
        para VARCHAR(150) NOT NULL,
        assunto VARCHAR(255) NOT NULL,
        html MEDIUMTEXT NULL,
        texto TEXT NULL,
        status ENUM('pendente', 'enviando', 'enviado', 'falhou') NOT NULL DEFAULT 'pendente',
        tentativas INT NOT NULL DEFAULT 0,
        proxima_tentativa_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        lote CHAR(36) NULL,
        travado_em DATETIME NULL,
        ultimo_erro VARCHAR(500) NULL,
        provedor_id VARCHAR(100) NULL,
        enviado_em DATETIME NULL,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_email_fila_status (status, proxima_tentativa_em),
        KEY idx_email_fila_lote (lote),
        KEY idx_email_fila_para (para)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 /*T![auto_id_cache] AUTO_ID_CACHE=1 */
    `);
  }
};
