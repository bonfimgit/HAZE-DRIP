
const { loadEnvFile } = require('node:process');
loadEnvFile();

const path = require('path');
const fs = require('fs/promises');

const db = require('./db');
const cloudinary = require('./cloudinary');


async function migrarCampanhas() {

    try {

        // Busca somente campanhas antigas
        // que ainda usam /uploads/
        const [campanhas] = await db.execute(
            `SELECT
                id,
                titulo,
                imagem_url
             FROM campanhas
             WHERE cloudinary_public_id IS NULL
             AND imagem_url LIKE '/uploads/%'
             ORDER BY id ASC`
        );


        console.log(
            `${campanhas.length} campanha(s) encontrada(s) para migração.`
        );


        for (const campanha of campanhas) {

            const nomeArquivo = path.basename(
                campanha.imagem_url
            );


            const caminhoArquivo = path.join(
                __dirname,
                'uploads',
                nomeArquivo
            );


            try {

                // Confirma se o arquivo ainda existe
                await fs.access(caminhoArquivo);


                console.log(
                    `Migrando campanha ${campanha.id} - ${campanha.titulo}`
                );


                // Envia para Cloudinary
                const resultado =
                    await cloudinary.uploader.upload(
                        caminhoArquivo,
                        {
                            folder: 'haze-drip/campanhas',
                            resource_type: 'image'
                        }
                    );


                // Atualiza o registro existente
                await db.execute(
                    `UPDATE campanhas
                     SET
                        imagem_url = ?,
                        cloudinary_public_id = ?
                     WHERE id = ?`,
                    [
                        resultado.secure_url,
                        resultado.public_id,
                        campanha.id
                    ]
                );


                console.log(
                    `Campanha ${campanha.id} migrada com sucesso.`
                );


            } catch (erroCampanha) {

                console.error(
                    `Erro ao migrar campanha ${campanha.id}:`,
                    erroCampanha.message
                );

            }
        }


        console.log(
            'Migração das campanhas concluída.'
        );


    } catch (erro) {

        console.error(
            'Erro durante a migração das campanhas:',
            erro.message
        );


    } finally {

        await db.end();

    }
}


migrarCampanhas();