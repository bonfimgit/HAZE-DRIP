const path = require('path');
const fs = require('fs/promises');

const db = require('../config/db');
const { emTransacao } = require('../utils/transacao');
const { naoEncontrado } = require('../utils/erros');
const {
  enviarImagemCloudinary,
  removerImagemCloudinary
} = require('../middlewares/upload');
const logger = require('../utils/logger');
const produtosService = require('./produtosService');


async function listar(produtoId) {

  const [imagens] = await db.execute(
    `SELECT *
     FROM produto_imagens
     WHERE produto_id = ?
     ORDER BY principal DESC, ordem ASC, id ASC`,
    [produtoId]
  );

  return imagens;
}


async function adicionar(produtoId, buffer) {

  await produtosService.garantirExiste(produtoId);

  const imagemCloudinary = await enviarImagemCloudinary(
    buffer,
    'haze-drip/produtos'
  );

  try {

    const [resultado] = await db.execute(
      `INSERT INTO produto_imagens
        (produto_id, url, cloudinary_public_id)
       VALUES (?, ?, ?)`,
      [produtoId, imagemCloudinary.secure_url, imagemCloudinary.public_id]
    );

    // Se o produto ainda não tem foto principal, esta passa a ser
    const [principais] = await db.execute(
      `SELECT id
       FROM produto_imagens
       WHERE produto_id = ?
       AND principal = TRUE
       LIMIT 1`,
      [produtoId]
    );

    if (principais.length === 0) {
      await db.execute(
        'UPDATE produto_imagens SET principal = TRUE WHERE id = ?',
        [resultado.insertId]
      );
    }

    const [imagens] = await db.execute(
      'SELECT * FROM produto_imagens WHERE id = ?',
      [resultado.insertId]
    );

    return imagens[0];

  } catch (erro) {

    // O banco falhou: remove a imagem que já subiu
    try {
      await removerImagemCloudinary(imagemCloudinary.public_id);
    } catch (erroCloudinary) {
      logger.erro('Erro ao limpar imagem do Cloudinary', {
        erro: erroCloudinary.message
      });
    }

    throw erro;
  }
}


async function remover(produtoId, imagemId) {

  const imagem = await emTransacao(async conexao => {

    const [imagens] = await conexao.execute(
      `SELECT *
       FROM produto_imagens
       WHERE id = ?
       AND produto_id = ?
       FOR UPDATE`,
      [imagemId, produtoId]
    );

    if (imagens.length === 0) {
      throw naoEncontrado('Imagem não encontrada');
    }

    await conexao.execute(
      'DELETE FROM produto_imagens WHERE id = ? AND produto_id = ?',
      [imagemId, produtoId]
    );

    // Se era a principal, escolhe outra imagem
    if (Number(imagens[0].principal) === 1) {

      const [restantes] = await conexao.execute(
        `SELECT id
         FROM produto_imagens
         WHERE produto_id = ?
         ORDER BY ordem ASC, id ASC
         LIMIT 1`,
        [produtoId]
      );

      if (restantes.length > 0) {
        await conexao.execute(
          'UPDATE produto_imagens SET principal = TRUE WHERE id = ?',
          [restantes[0].id]
        );
      }
    }

    return imagens[0];
  });

  // Depois do banco confirmado, remove o arquivo
  try {

    if (imagem.cloudinary_public_id) {

      await removerImagemCloudinary(imagem.cloudinary_public_id);

    } else {

      // Imagens antigas, salvas em disco antes do Cloudinary
      await fs.unlink(
        path.join(__dirname, '..', '..', 'uploads', path.basename(imagem.url))
      );
    }

  } catch (erro) {

    if (erro.code !== 'ENOENT') {
      logger.erro('Imagem removida do banco, mas o arquivo não foi apagado', {
        imagemId,
        erro: erro.message
      });
    }
  }
}


async function definirPrincipal(produtoId, imagemId) {

  const [encontradas] = await db.execute(
    `SELECT id
     FROM produto_imagens
     WHERE id = ?
     AND produto_id = ?`,
    [imagemId, produtoId]
  );

  if (encontradas.length === 0) {
    throw naoEncontrado('Imagem não encontrada para este produto');
  }

  await db.execute(
    `UPDATE produto_imagens
     SET principal = (id = ?)
     WHERE produto_id = ?`,
    [imagemId, produtoId]
  );

  return listar(produtoId);
}


module.exports = {
  listar,
  adicionar,
  remover,
  definirPrincipal
};
