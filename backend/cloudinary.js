const { loadEnvFile } = require('node:process');
try{
loadEnvFile();
} catch (erro) {
    if (erro.code !== 'ENOENT') {
        throw erro;
    }
}

const { v2: cloudinary } = require('cloudinary');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

module.exports = cloudinary;