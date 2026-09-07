const { loadEnvFile } = require('node:process');
loadEnvFile();

const path = require('path');
const fs = require('fs/promises');

const db = require('./db');
const cloudinary = require('./cloudinary');

async function migrarImagens() {

    try {

        const [imagens] = await db.execute(
            `SELECT
                id,
                produto_id,
                url
             FROM produto_imagens
             WHERE cloudinary_public_id IS NULL
             AND url LIKE '/uploads/%'
             ORDER BY id ASC`
        );

        console.log(
            `${imagens.length} imagem(ns) encontrada(s) para migração.`
        );

        for (const imagem of imagens) {

            const nomeArquivo = path.basename(imagem.url);

            const caminhoArquivo = path.join(
                __dirname,
                'uploads',
                nomeArquivo
            );

            try {

                // Confirma que o arquivo realmente existe no HD
                await fs.access(caminhoArquivo);

                console.log(
                    `Migrando imagem ${imagem.id}: ${nomeArquivo}`
                );

                // Envia arquivo local para o Cloudinary
                const resultadoCloudinary =
                    await cloudinary.uploader.upload(
                        caminhoArquivo,
                        {
                            folder: 'haze-drip/produtos',
                            resource_type: 'image'
                        }
                    );

                // Atualiza o registro que já existia
                await db.execute(
                    `UPDATE produto_imagens
                     SET
                        url = ?,
                        cloudinary_public_id = ?
                     WHERE id = ?`,
                    [
                        resultadoCloudinary.secure_url,
                        resultadoCloudinary.public_id,
                        imagem.id
                    ]
                );

                console.log(
                    `Imagem ${imagem.id} migrada com sucesso.`
                );

            } catch (erroImagem) {

                console.error(
                    `Erro na imagem ${imagem.id}:`,
                    erroImagem.message
                );
            }
        }

        console.log('Migração concluída.');

    } catch (erro) {

        console.error(
            'Erro durante a migração:',
            erro.message
        );

    } finally {

        await db.end();
    }
}

migrarImagens();