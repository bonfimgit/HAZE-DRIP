module.exports = {

  descricao: 'Versão de token e último login dos administradores',

  async up(conexao, { adicionarColuna }) {

    // Incrementar invalida todos os tokens já emitidos (troca de senha, desativação)
    await adicionarColuna('usuarios_admin', 'token_versao', 'INT NOT NULL DEFAULT 0');
    await adicionarColuna('usuarios_admin', 'ultimo_login_em', 'DATETIME NULL');
  }
};
