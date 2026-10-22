const multer = require('multer');

const cloudinary = require('../config/cloudinary');
const { requisicaoInvalida, ErroApp } = require('../utils/erros');
const logger = require('../utils/logger');

const TIPOS_PERMITIDOS = [
  'image/jpeg',
  'image/png',
  'image/webp'
];

// Imagens ficam em memória e seguem direto para o Cloudinary
const uploadImagem = multer({

  storage: multer.memoryStorage(),

  fileFilter: (req, file, cb) => {
    if (TIPOS_PERMITIDOS.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(requisicaoInvalida('Apenas imagens JPG, PNG ou WEBP são permitidas'));
    }
  },

  limits: {
    fileSize: 5 * 1024 * 1024
  }
});


function enviarImagemCloudinary(buffer, pasta) {

  return new Promise((resolve, reject) => {

    const stream = cloudinary.uploader.upload_stream(
      {
        folder: pasta,
        resource_type: 'image'
      },
      (erro, resultado) => {
        if (erro) {
          // Sem isso a resposta seria só "Erro interno do servidor"
          logger.erro('Falha ao enviar imagem ao Cloudinary', {
            erro: erro.message,
            status: erro.http_code
          });
          return reject(new ErroApp(
            502,
            `Não foi possível enviar a imagem ao Cloudinary (${erro.message || 'erro desconhecido'}). ` +
            'Confira CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY e CLOUDINARY_API_SECRET no Render.'
          ));
        }
        resolve(resultado);
      }
    );

    stream.end(buffer);
  });
}


async function removerImagemCloudinary(publicId) {
  if (publicId) {
    await cloudinary.uploader.destroy(publicId);
  }
}


module.exports = {
  uploadImagem,
  enviarImagemCloudinary,
  removerImagemCloudinary
};
