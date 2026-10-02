const multer = require('multer');

const cloudinary = require('../config/cloudinary');
const { requisicaoInvalida } = require('../utils/erros');

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
          return reject(erro);
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
