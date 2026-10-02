const { v2: cloudinary } = require('cloudinary');

const config = require('./ambiente');

cloudinary.config(config.cloudinary);

module.exports = cloudinary;
