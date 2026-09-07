const bcrypt = require('bcryptjs');
const db = require('./db');

async function criarAdmin() {

    const nome = 'Gerente Haze';
    const email = 'gerente@hazedrip.com';

    const senha = process.argv[2];

    if (!senha) {
        console.log('Informe uma senha.');
        console.log('Exemplo: node criar-admin.js MinhaSenha');
        process.exit(1);
    }

    try {

        const senhaHash = await bcrypt.hash(senha, 12);

        await db.execute(
            `INSERT INTO usuarios_admin
            (
                nome,
                email,
                senha_hash,
                perfil
            )
            VALUES (?, ?, ?, ?)`,
            [
                nome,
                email,
                senhaHash,
                'gerente'
            ]
        );

        console.log('Usuário administrativo criado com sucesso.');

    } catch (erro) {

        console.error(
            'Erro ao criar usuário:',
            erro.message
        );

    } finally {

        process.exit();
    }
}

criarAdmin();