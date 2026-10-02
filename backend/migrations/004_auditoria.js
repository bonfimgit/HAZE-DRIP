module.exports = {

  descricao: 'Auditoria de ações administrativas',

  async up(conexao) {

    await conexao.query(`
      CREATE TABLE IF NOT EXISTS auditoria_admin (
        id INT AUTO_INCREMENT PRIMARY KEY,
        admin_id INT NULL,
        admin_email VARCHAR(150) NULL,
        metodo VARCHAR(10) NOT NULL,
        rota VARCHAR(255) NOT NULL,
        status_http INT NOT NULL,
        ip VARCHAR(64) NULL,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_auditoria_admin (admin_id, criado_em),
        KEY idx_auditoria_criado_em (criado_em)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }
};
