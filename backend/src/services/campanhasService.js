const db = require('../config/db');
const { emTransacao } = require('../utils/transacao');
const { naoEncontrado } = require('../utils/erros');
const {
  enviarImagemCloudinary,
  removerImagemCloudinary
} = require('../middlewares/upload');
const logger = require('../utils/logger');
const { CAMPANHA_VIGENTE } = require('./promocoesService');


async function buscarAtivaLoja() {

  const [campanhas] = await db.execute(
    `SELECT
        id,
        titulo,
        subtitulo,
        imagem_url,
        texto_botao,
        link_botao
     FROM campanhas c
     WHERE ${CAMPANHA_VIGENTE}
     ORDER BY c.atualizado_em DESC
     LIMIT 1`
  );

  if (campanhas.length === 0) {
    throw naoEncontrado('Nenhuma campanha ativa');
  }

  return campanhas[0];
}


async function anexarProdutos(conexao, campanhas) {

  if (campanhas.length === 0) {
    return campanhas;
  }

  const [linhas] = await conexao.query(
    'SELECT campanha_id, produto_id FROM campanha_produtos WHERE campanha_id IN (?)',
    [campanhas.map(c => c.id)]
  );

  return campanhas.map(campanha => ({
    ...campanha,
    produto_ids: linhas
      .filter(linha => linha.campanha_id === campanha.id)
      .map(linha => linha.produto_id)
  }));
}


async function listarTodas() {

  const [campanhas] = await db.execute(
    'SELECT * FROM campanhas ORDER BY atualizado_em DESC, id DESC'
  );

  return anexarProdutos(db, campanhas);
}


async function buscar(conexao, id) {

  const [campanhas] = await conexao.execute(
    'SELECT * FROM campanhas WHERE id = ?',
    [id]
  );

  if (campanhas.length === 0) {
    throw naoEncontrado('Campanha não encontrada');
  }

  const [campanha] = await anexarProdutos(conexao, campanhas);

  return campanha;
}


// Substitui os produtos participantes da promoção
async function salvarProdutos(conexao, campanhaId, produtoIds) {

  if (produtoIds === undefined) {
    return;
  }

  await conexao.execute(
    'DELETE FROM campanha_produtos WHERE campanha_id = ?',
    [campanhaId]
  );

  for (const produtoId of produtoIds) {
    await conexao.execute(
      `INSERT IGNORE INTO campanha_produtos (campanha_id, produto_id)
       SELECT ?, id FROM produtos WHERE id = ?`,
      [campanhaId, produtoId]
    );
  }
}


async function limparImagem(publicId, contexto) {
  try {
    await removerImagemCloudinary(publicId);
  } catch (erro) {
    logger.erro(contexto, { erro: erro.message });
  }
}


async function criar(dados, buffer) {

  const imagem = await enviarImagemCloudinary(buffer, 'haze-drip/campanhas');

  try {

    return await emTransacao(async conexao => {

      // Só existe uma campanha ativa por vez
      if (dados.ativo) {
        await conexao.execute(
          'UPDATE campanhas SET ativo = FALSE WHERE ativo = TRUE'
        );
      }

      const [resultado] = await conexao.execute(
        `INSERT INTO campanhas
          (titulo, subtitulo, imagem_url, cloudinary_public_id,
           texto_botao, link_botao, ativo, inicio_em, fim_em, desconto_percentual)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          dados.titulo,
          dados.subtitulo,
          imagem.secure_url,
          imagem.public_id,
          dados.textoBotao,
          dados.linkBotao,
          dados.ativo,
          dados.inicioEm,
          dados.fimEm,
          dados.descontoPercentual
        ]
      );

      await salvarProdutos(conexao, resultado.insertId, dados.produtoIds);

      return buscar(conexao, resultado.insertId);
    });

  } catch (erro) {

    await limparImagem(imagem.public_id, 'Erro ao limpar imagem do Cloudinary');
    throw erro;
  }
}


async function atualizar(id, dados, buffer) {

  let novaImagem = null;

  try {

    const { campanha, publicIdAntigo } = await emTransacao(async conexao => {

      const [campanhas] = await conexao.execute(
        'SELECT * FROM campanhas WHERE id = ? FOR UPDATE',
        [id]
      );

      if (campanhas.length === 0) {
        throw naoEncontrado('Campanha não encontrada');
      }

      const atual = campanhas[0];

      let imagemUrl = atual.imagem_url;
      let publicId = atual.cloudinary_public_id;

      if (buffer) {
        novaImagem = await enviarImagemCloudinary(buffer, 'haze-drip/campanhas');
        imagemUrl = novaImagem.secure_url;
        publicId = novaImagem.public_id;
      }

      if (dados.ativo) {
        await conexao.execute(
          'UPDATE campanhas SET ativo = FALSE WHERE id <> ? AND ativo = TRUE',
          [id]
        );
      }

      await conexao.execute(
        `UPDATE campanhas
         SET
            titulo = ?,
            subtitulo = ?,
            imagem_url = ?,
            cloudinary_public_id = ?,
            texto_botao = ?,
            link_botao = ?,
            ativo = ?,
            inicio_em = ?,
            fim_em = ?,
            desconto_percentual = ?
         WHERE id = ?`,
        [
          dados.titulo,
          dados.subtitulo,
          imagemUrl,
          publicId,
          dados.textoBotao,
          dados.linkBotao,
          dados.ativo,
          dados.inicioEm,
          dados.fimEm,
          dados.descontoPercentual,
          id
        ]
      );

      await salvarProdutos(conexao, id, dados.produtoIds);

      return {
        campanha: await buscar(conexao, id),
        publicIdAntigo: buffer ? atual.cloudinary_public_id : null
      };
    });

    // Banco confirmado: apaga a imagem antiga
    if (publicIdAntigo && publicIdAntigo !== campanha.cloudinary_public_id) {
      await limparImagem(
        publicIdAntigo,
        'Campanha atualizada, mas houve erro ao excluir imagem antiga'
      );
    }

    return campanha;

  } catch (erro) {

    if (novaImagem) {
      await limparImagem(
        novaImagem.public_id,
        'Erro ao limpar nova imagem do Cloudinary'
      );
    }

    throw erro;
  }
}


async function desativar(id) {

  const [resultado] = await db.execute(
    'UPDATE campanhas SET ativo = FALSE WHERE id = ?',
    [id]
  );

  if (resultado.affectedRows === 0) {
    throw naoEncontrado('Campanha não encontrada');
  }
}


async function ativar(id) {

  return emTransacao(async conexao => {

    await buscar(conexao, id);

    await conexao.execute(
      'UPDATE campanhas SET ativo = FALSE WHERE ativo = TRUE AND id <> ?',
      [id]
    );

    await conexao.execute(
      'UPDATE campanhas SET ativo = TRUE WHERE id = ?',
      [id]
    );

    return buscar(conexao, id);
  });
}


module.exports = {
  buscarAtivaLoja,
  listarTodas,
  criar,
  atualizar,
  desativar,
  ativar
};
