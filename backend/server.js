//Começo do servidor em node.js
const express = require('express');

const cors = require('cors');

//linha que importa para o server.js aquilo que o arquivo db.js está exportando
const db = require('./db');
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');

const API_URL = "https://hazedrip-production-6a67.up.railway.app";
const cloudinary = require('./cloudinary');

//criação de login do admin
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

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

function autenticarAdmin(req, res, next) {

    const authorization = req.headers.authorization;

    if (!authorization) {
        return res.status(401).json({
            mensagem: 'Token não fornecido'
        });
    }

    const partes = authorization.split(' ');

    if (
        partes.length !== 2 ||
        partes[0] !== 'Bearer'
    ) {
        return res.status(401).json({
            mensagem: 'Formato de token inválido'
        });
    }

    const token = partes[1];

    try {

        const dados = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        req.admin = dados;

        //Quando o middleware termina de verificar o token continua a proxima função
        next();

    } catch (erro) {

        if (erro.name === 'TokenExpiredError') {
            return res.status(401).json({
                mensagem: 'Token expirado'
            });
        }

        return res.status(401).json({
            mensagem: 'Token inválido'
        });
    }
}

//Criação de aplicação do servidor
const app = express();


const origensPermitidas = (process.env.FRONTEND_URLS || '') 
    .split(',')
    .map(origem => origem.trim())
    .filter(Boolean);

app.use(cors({
    origin: function (origin, callback) {

        // Permite requisições sem Origin,
        // como PowerShell, curl e algumas ferramentas de teste
        if (!origin) {
            return callback(null, true);
        }

        if (origensPermitidas.includes(origin)) {
            return callback(null, true);
        }

        return callback(
            new Error('Origem não permitida pelo CORS')
        );
    }
}));

//Linha middleware para permitir o uso de JSON nas requisições
app.use(express.json());

//middleware do express para servir arquivos estáticos (imagens)
app.use('/uploads', express.static('uploads'));

//rota puclica simples
app.get('/health', async (req, res) => {

    try {

        await db.execute('SELECT 1');

        res.json({
            status: 'ok',
            banco: 'conectado'
        });

    } catch (erro) {

        res.status(500).json({
            status: 'erro',
            banco: 'desconectado'
        });
    }
});

//Definição da porta do servidor
const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});

async function testarConexao() {
    try {
        await db.query('SELECT 1');
        console.log('MySQL conectado com sucesso');
    } catch (erro) {
        console.error('Erro ao conectar ao MySQL:', erro.message);
    }
}

testarConexao();


//formatos permitidos JPG, PNG ou WEBP
const filtroImagem = (req, file, cb) => {
    const tiposPermitidos = [
        'image/jpeg',
        'image/png',
        'image/webp'
    ];

    if (tiposPermitidos.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Apenas imagens JPG, PNG ou WEBP são permitidas'));
    }
};

const storage = multer.diskStorage({
    
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },

    filename: (req, file, cb) => {
        const nomeUnico =
            Date.now() +
            '-'+
            Math.round(Math.random() * 1E9);

            const extensao = path.extname(file.originalname);

            cb(null, nomeUnico + extensao);
    }
});

const uploadCloud = multer({
    storage: multer.memoryStorage(),

    fileFilter: filtroImagem,

    limits: {
        fileSize: 5 * 1024 * 1024
    }
});


//limitador de arquivos 

const upload = multer ({
    storage: storage,

    fileFilter: filtroImagem,

    limits: {
        fileSize: 5 * 1024 * 1024
    }
});


//Definição de rota para a raiz do servidor para busca
app.get('/', (req, res) => {
    res.send('API Haze Drip funcionando!');
});

//Rota assíncrona com o banco de dados

app.get('/produtos', async (req, res) => {
 
    try {

        //somente produtos ativos ficarão disponiveis para os clientes
        const[rows] = await db.query(`
            SELECT
                p.*,
                c.nome AS categoria_nome,
                (
                    SELECT pi.url
                    FROM produto_imagens pi
                    WHERE pi.produto_id = p.id
                    AND pi.principal = TRUE
                    LIMIT 1
                )  AS imagem_principal

                  FROM produtos p

                  LEFT JOIN categorias c
                    ON c.id = p.categoria_id

                  WHERE p.ativo = TRUE

                  ORDER BY p.criado_em DESC

        `);
    
    res.json(rows);

    } catch (erro) {
        
        console.error('Erro ao buscar produtos:', erro.message);

        res.status(500).json({
            mensagem: 'Erro ao buscar produtos'
        });
    }
});

app.get('/produtos/destaques', async (req, res) => {

    try {

        const [produtos] = await db.execute(
            `SELECT
                p.*,
                c.nome AS categoria_nome,

                (
                    SELECT pi.url
                    FROM produto_imagens pi
                    WHERE pi.produto_id = p.id
                    AND pi.principal = TRUE
                    LIMIT 1
                ) AS imagem_principal

             FROM produtos p

             LEFT JOIN categorias c
                ON c.id = p.categoria_id

             WHERE p.ativo = TRUE
             AND p.destaque_home = TRUE

             ORDER BY p.criado_em DESC`
        );

        res.json(produtos);

    } catch (erro) {

        console.error(
            'Erro ao buscar destaques da Home:',
            erro.message
        );

        res.status(500).json({
            mensagem: 'Erro ao buscar produtos em destaque'
        });
    }
});

app.get('/produtos/:id', async(req, res) => {

    const produtoId = Number(req.params.id);

    if (
        !Number.isInteger(produtoId)|| produtoId <= 0
    ) {
        return res.status(400).json ({
            mensagem: 'ID do produto inválido'
        });
    }

    try {

        const [produtos] = await db.execute(
            `SELECT
                p.*,
                c.nome AS categoria_nome
                FROM produtos p
                
                LEFT JOIN categorias c
                ON c.id = p.categoria_id
                WHERE p.id = ?
                AND p.ativo= TRUE`,
                [produtoId]
        );

        if(produtos.lenght === 0) {
            return res.status(404).json ({
                mensagem: 'Produto não encontrado'
            });
        }

        const produto = produtos[0];

        const [imagens] = await db.execute(
            `SELECT
                id,
                url,
                principal,
                ordem
                FROM produto_imagens
                WHERE produto_id = ?
                ORDER BY principal DESC, ordem ASC, id ASC`,
                [produtoId]
        );

        const [variacoes] = await db.execute(
            `SELECT
                id,
                tamanho,
                cor,
                estoque,
                sku
                FROM produto_variacoes
                WHERE produto_id = ?
                AND ativo = TRUE
                ORDER BY cor ASC, tamanho ASC`,
                [produtoId]
        );
        
        const estoqueTotal = variacoes.reduce(
            (total, variacao) => total + variacao.estoque, 0
        );

        res.json({
            ...produto,
            estoque_total: estoqueTotal,
            imagens: imagens,
            variacoes: variacoes
        });
    } catch (erro) {
        
        console.error(
            'Erro ao buscar produtos:', erro.message
        );

        res.status(500).json({
            mensagem: 'Erro ao buscar produto'
        });
    }
});

app.get('/produtos/:id/imagens', async (req, res) => {

    const produtoId = Number(req.params.id);

    if (!Number.isInteger(produtoId) || produtoId <= 0) {
        return res.status(400).json ({
            mensagem: 'ID do produto inválido'
        });
    }
        try {
            const [imagens] = await db.execute(
                `SELECT * FROM produto_imagens
                 WHERE produto_id =? 
                 ORDER BY principal DESC, ordem ASC, id ASC`,
                 [produtoId]
            );

            res.json(imagens);
        } catch (erro) {
            
            console.error(
                'Erro ao buscar imagens do produto:', erro.message           
            );

            res.status(500).json({
                mensagem: 'Erro ao buscar imagens do produto'
            });
        }
});

app.get ('/produtos/:id/variacoes', async (req, res) => {

    const produtoId = Number(req.params.id);

    if(!Number.isInteger(produtoId) || produtoId <= 0) {
        return res.status(400).json ({
            mensagem: 'ID do produto inválido'
        });
    }
    
    try {

        const [variacoes] = await db.execute(
            `SELECT
                id,
                produto_id,
                tamanho,
                cor,
                estoque,
                sku,
                ativo,
                criado_em
                FROM produto_variacoes
                WHERE produto_id = ?
                AND ativo = TRUE
                ORDER BY cor ASC, tamanho ASC`,
                [produtoId]
        );

        res.json(variacoes);
    } catch (erro) {
        console.error(
            'Erro ao buscar variações:',
            erro.message
        );

        res.status(500).json({
            mensagem:'Erro ao buscar variações'
        });
    }
});

app.get('/categorias',async (req,res) => {
    try {
        
        const[categorias] = await db.execute(`
            SELECT id, nome
            FROM categorias
            WHERE ativo = TRUE
            ORDER BY nome ASC
            `);

            res.json(categorias);
    } catch (erro) {
        console.error('Erro ao buscar categorias:',erro.message);

        res.status(500).json({
            mensagem:'Erro ao buscar categorias'
        });
    }
});

app.get('/campanha', async (req, res) => {
    try {
        
        const [campanhas] = await db.execute(
            `SELECT
                id,
                titulo,
                subtitulo,
                imagem_url,
                texto_botao,
                link_botao
                FROM campanhas
                WHERE ativo = TRUE
                ORDER BY atualizado_em DESC
                LIMIT 1`
        );

        if (campanhas.length === 0) {
            return res.status(404).json ({
                mensagem: 'Nenhuma campanha ativa'
            });
        }
        res.json(campanhas[0]);
    } catch(erro) {
        
        console.error(
            'Erro ao buscar campanha:',erro.message
        );

        res.status(500).json({
            mengagem:'Erro ao buscar campanha'
        });
    }
});

app.post('/admin/login', async (req, res) => {

    const {
        email,
        senha
    } = req.body;

    if (
        !email ||
        !email.trim() ||
        !senha
    ) {
        return res.status(400).json({
            mensagem: 'E-mail e senha são obrigatórios'
        });
    }

    try {

        const [usuarios] = await db.execute(
            `SELECT *
             FROM usuarios_admin
             WHERE email = ?
             AND ativo = TRUE
             LIMIT 1`,
            [email.trim().toLowerCase()]
        );

        if (usuarios.length === 0) {
            return res.status(401).json({
                mensagem: 'E-mail ou senha inválidos'
            });
        }

        const usuario = usuarios[0];

        const senhaCorreta = await bcrypt.compare(
            senha,
            usuario.senha_hash
        );

        if (!senhaCorreta) {
            return res.status(401).json({
                mensagem: 'E-mail ou senha inválidos'
            });
        }

        const token = jwt.sign(
            {
                id: usuario.id,
                email: usuario.email,
                perfil: usuario.perfil
            },
            process.env.JWT_SECRET,
            {
                expiresIn: '8h'
            }
        );

        res.json({
            mensagem: 'Login realizado com sucesso',

            usuario: {
                id: usuario.id,
                nome: usuario.nome,
                email: usuario.email,
                perfil: usuario.perfil
            },

            token: token
        });

    } catch (erro) {

        console.error(
            'Erro ao realizar login:',
            erro.message
        );

        res.status(500).json({
            mensagem: 'Erro interno ao realizar login'
        });
    }
});

//Rota do banco de dados para o gerente

app.get('/admin/produtos', autenticarAdmin, async (req, res) =>{

    try {

        const [rows] = await db.query(`
            SELECT
                p.*,
                c.nome AS categoria_nome,
                (
                    SELECT pi.url
                    FROM produto_imagens pi
                    WHERE pi.produto_id = p.id
                    AND pi.principal = TRUE
                    LIMIT 1
                ) AS imagem_principal

                FROM produtos p

                LEFT JOIN categorias c
                    ON c.id = p.categoria_id

                ORDER BY p.criado_em DESC
            `);

            res.json(rows);
    } catch (erro) {

        console.error('Erro ao buscar produtos administrativos:', erro.message);

        res.status(500).json({
            mensagem: 'Erro ao buscar produtos'
        });
    }

});

//get do gerente que vai conseguir vizualizar tudo
app.get('/admin/produtos',(req, res) =>{
    res.json(produtos);
});

/* =============================================================
   BUSCAR UM PRODUTO NO ADMIN
============================================================= */

app.get(
    '/admin/produtos/:id',
    autenticarAdmin,
    async (req, res) => {

        const produtoId =
            Number(req.params.id);


        if (
            !Number.isInteger(produtoId) ||
            produtoId <= 0
        ) {

            return res.status(400).json({
                mensagem:
                    'ID do produto inválido'
            });

        }


        try {

            const [produtos] =
                await db.execute(
                    `SELECT
                        p.*,
                        c.nome AS categoria_nome

                     FROM produtos p

                     LEFT JOIN categorias c
                        ON c.id = p.categoria_id

                     WHERE p.id = ?`,
                    [produtoId]
                );


            if (produtos.length === 0) {

                return res.status(404).json({
                    mensagem:
                        'Produto não encontrado'
                });

            }


            const produto =
                produtos[0];


            const [imagens] =
                await db.execute(
                    `SELECT
                        id,
                        url,
                        principal,
                        ordem

                     FROM produto_imagens

                     WHERE produto_id = ?

                     ORDER BY
                        principal DESC,
                        ordem ASC,
                        id ASC`,
                    [produtoId]
                );


            res.json({
                ...produto,
                imagens
            });


        } catch (erro) {

            console.error(
                'Erro ao buscar produto administrativo:',
                erro.message
            );


            res.status(500).json({
                mensagem:
                    'Erro ao buscar produto'
            });

        }

    }
);

/* POST rota de cadastro
ROTA QUE VAI RECEBER OS DADOS DO MYSQL NO CADASTRO 
*/
app.post('/produtos', autenticarAdmin, async (req, res) => {

    const {
        nome,
        descricao = null,
        preco,
        categoria_id,
        ativo = true,
        destaque_home = false
    } = req.body;

    if (!nome || !nome.trim()) {
        return res.status(400).json({
            mensagem: 'Nome do produto é obrigatório'
        });
    }

    if(preco == null || categoria_id == null) {
        return res.status(400).json({
            mensagem: 'Preço e categoria são obrigatórios'
        });
    }

    const precoNumero = Number (preco);

    if(
        !Number.isFinite(precoNumero) || precoNumero <= 0
    ) {
        return res.status(400).json ({
            mensagem: 'Preço deve ser um número maior que zero'
        });
    }

    try {

        const [categorias] = await db.execute(
            `SELECT id, nome
             FROM categorias
             WHERE id = ?
             AND ativo = TRUE`,
             [categoria_id]
        );

        if (categorias.length === 0) {
            return res.status(400).json ({
                mensagem:'Categoria inválida ou inativa'
            });
        }

        const [resultado] = await db.execute(`
            INSERT INTO produtos
            (
                nome,
                descricao,
                preco,
                categoria_id,
                ativo,
                destaque_home
            )
            VALUES(?, ?, ?, ?, ?, ?)    
            
            `, [
                nome.trim(),
                descricao
                    ? descricao.trim() : null,
                preco,
                categoria_id,
                ativo,
                destaque_home
            
    ]);

        const [produtoCriado] = await db.execute(
            'SELECT * FROM produtos WHERE id = ?',
            [resultado.insertId]

        );

        res.status(201).json(produtoCriado[0]);

    } catch (erro) {

        console.error('Erro ao cadastrar produto:', erro.message);

        res.status(500).json({
            mensagem: 'Erro ao cadastrar produto'

        });
    }
});

app.put('/produtos/:id', autenticarAdmin, async (req, res) => {

    const id = Number(req.params.id);

    const {
        nome,
        descricao,
        preco,
        categoria_id,
        ativo,
        destaque_home
    } = req.body;


    if (
        !Number.isInteger(id) ||
        id <= 0
    ) {

        return res.status(400).json({
            mensagem:
                'ID do produto inválido'
        });

    }


    if (
        !nome ||
        !nome.trim()
    ) {

        return res.status(400).json({
            mensagem:
                'Nome do produto é obrigatório'
        });

    }


    if (
        preco == null ||
        categoria_id == null ||
        ativo == null ||
        destaque_home == null
    ) {

        return res.status(400).json({
            mensagem:
                'Dados obrigatórios não informados'
        });

    }


    const precoNumero =
        Number(preco);


    if (
        !Number.isFinite(precoNumero) ||
        precoNumero <= 0
    ) {

        return res.status(400).json({
            mensagem:
                'Preço deve ser um número maior que zero'
        });

    }


    try {

        /* =========================================================
           VALIDAR CATEGORIA
        ========================================================= */

        const [categorias] =
            await db.execute(
                `SELECT id
                 FROM categorias
                 WHERE id = ?
                 AND ativo = TRUE`,
                [categoria_id]
            );


        if (categorias.length === 0) {

            return res.status(400).json({
                mensagem:
                    'Categoria inválida ou inativa'
            });

        }


        /* =========================================================
           DEFINIR STATUS SOLICITADO
        ========================================================= */

        const ativarProduto =
            ativo === true ||
            ativo === 1 ||
            ativo === '1' ||
            String(ativo).toLowerCase() === 'true';


        let ativoFinal =
            ativarProduto
                ? 1
                : 0;


        let avisoAtivacao =
            null;


        /* =========================================================
           VALIDAR SE PODE SER PUBLICADO
        ========================================================= */

        if (ativarProduto) {

            /* FOTO PRINCIPAL */

            const [imagens] =
                await db.execute(
                    `SELECT id
                     FROM produto_imagens
                     WHERE produto_id = ?
                     AND principal = TRUE
                     LIMIT 1`,
                    [id]
                );


            if (imagens.length === 0) {

                ativoFinal = 0;

                avisoAtivacao =
                    'Dados salvos, mas o produto continua inativo: adicione uma foto principal.';

            }


            /* VARIAÇÕES */

            if (!avisoAtivacao) {

                const [variacoes] =
                    await db.execute(
                        `SELECT id, estoque
                         FROM produto_variacoes
                         WHERE produto_id = ?
                         AND ativo = TRUE`,
                        [id]
                    );


                if (variacoes.length === 0) {

                    ativoFinal = 0;

                    avisoAtivacao =
                        'Dados salvos, mas o produto continua inativo: adicione pelo menos uma variação ativa.';

                } else {

                    /* ESTOQUE */

                    const temEstoque =
                        variacoes.some(
                            variacao =>
                                Number(
                                    variacao.estoque
                                ) > 0
                        );


                    if (!temEstoque) {

                        ativoFinal = 0;

                        avisoAtivacao =
                            'Dados salvos, mas o produto continua inativo: adicione estoque disponível.';

                    }

                }

            }

        }


        /* =========================================================
           SALVAR DADOS DO PRODUTO
        ========================================================= */

        const [resultado] =
            await db.execute(
                `UPDATE produtos
                 SET
                    nome = ?,
                    descricao = ?,
                    preco = ?,
                    categoria_id = ?,
                    ativo = ?,
                    destaque_home = ?
                 WHERE id = ?`,
                [
                    nome.trim(),

                    descricao
                        ? descricao.trim()
                        : null,

                    precoNumero,
                    categoria_id,
                    ativoFinal,
                    destaque_home,
                    id
                ]
            );


        if (resultado.affectedRows === 0) {

            return res.status(404).json({
                mensagem:
                    'Produto não encontrado'
            });

        }


        /* =========================================================
           BUSCAR PRODUTO ATUALIZADO
        ========================================================= */

        const [produtoAtualizado] =
            await db.execute(
                `SELECT
                    p.*,
                    c.nome AS categoria_nome

                 FROM produtos p

                 LEFT JOIN categorias c
                    ON c.id = p.categoria_id

                 WHERE p.id = ?`,
                [id]
            );


        /* =========================================================
           RESPOSTA
        ========================================================= */

        return res.json({
            ...produtoAtualizado[0],
            aviso: avisoAtivacao
        });


    } catch (erro) {

        console.error(
            'Erro ao atualizar produto:',
            erro.message
        );


        return res.status(500).json({
            mensagem:
                'Erro ao atualizar produto'
        });

    }

});

//DELETAR/DESATIVAR PRODUTOS
app.delete('/produtos/:id', autenticarAdmin, async (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id)){
        return res.status(400).json ({
            mensagem: 'ID inválido'
        });
    }

    try {
        const [resultado] = await db.execute(
            `UPDATE produtos
             SET ativo = FALSE
             WHERE id = ?`,
            [id]
        );

        if (resultado.affectedRows === 0){
            return res.status(404).json({
                mensagem:'Produto não encontrado'
            });
        }
        res.json({
            mensagem: 'Produto desativado com sucesso'
        });
    } catch (erro) {
        console.error('Erro ao desativar produto:', erro.message);

        res.status(500).json({
            mensagem:'Erro ao desativar produto'
        });
    }
});
    
//REATIVAÇÃO PRODUTO
app.patch ('/produtos/:id/reativar', autenticarAdmin ,async(req, res) =>{
    const id = Number(req.params.id);
    
    if (!Number.isInteger(id)) {
        return res.status(400).json({
            mensagem: 'ID inválido'
        });
    }
    try {

        /* =========================================================
   VALIDAR PRODUTO ANTES DE REATIVAR
========================================================= */

const [imagens] = await db.execute(
    `SELECT id
     FROM produto_imagens
     WHERE produto_id = ?
     AND principal = TRUE
     LIMIT 1`,
    [id]
);


if (imagens.length === 0) {

    return res.status(400).json({
        mensagem:
            'O produto precisa ter uma foto principal antes de ser ativado.'
    });

}


const [variacoes] = await db.execute(
    `SELECT id, estoque
     FROM produto_variacoes
     WHERE produto_id = ?
     AND ativo = TRUE`,
    [id]
);


if (variacoes.length === 0) {

    return res.status(400).json({
        mensagem:
            'O produto precisa ter pelo menos uma variação ativa antes de ser ativado.'
    });

}


const temEstoque =
    variacoes.some(
        variacao =>
            Number(variacao.estoque) > 0
    );


if (!temEstoque) {

    return res.status(400).json({
        mensagem:
            'O produto precisa ter estoque disponível antes de ser ativado.'
    });

}

        const [resultado] = await db.execute(
            `UPDATE produtos
             SET ativo = TRUE
             WHERE id = ?`,
                [id]
        );

        if (resultado.affectedRows === 0) {
            return res.status(404).json ({
                mensagem: 'Produto não encontrado'
            });
        }

        const [produtoReativado] = await db.execute (
            'SELECT * FROM produtos WHERE id = ?',
            [id]
        );
        res.json ({
            mensagem: 'Produto reativado com sucesso!',
            produto: produtoReativado[0]
        });
    } catch (erro) {
        console.error('Erro ao reativar produto:', erro.message);

        res.status(500).json({
            mensagem: 'Erro ao reativar produto'
        });
    }
});


app.post('/produtos/:id/imagens', autenticarAdmin, uploadCloud.single('imagem'), async (req, res) => {

    const produtoId = Number(req.params.id);

    if (!Number.isInteger(produtoId) || produtoId <= 0){
        return res.status(400).json ({
            mensagem: 'ID do produto inválido'
        });
    }

    if (!req.file){
        return res.status(400).json ({
            mensagem:'Nenhuma imagem enviada'
        });
    }

    let imagemCloudinary = null;

    try {
        
        //Verifica primeiro se o produto existe
        const [produtos] = await db.execute(
            `SELECT id
             FROM produtos
             WHERE id = ?`,
             [produtoId]
        );

        if (produtos.length === 0){
            return res.status(404).json ({
                mensagem:'Produto não encontrado'
            });
        }
        
       imagemCloudinary = await enviarImagemCloudinary(
        req.file.buffer, 'haze-drip/produtos'
       );

        const urlImagem = imagemCloudinary.secure_url;
        const publicId = imagemCloudinary.public_id;


        const [resultado] = await db.execute(
            `INSERT INTO produto_imagens
                (produto_id, 
                url,
                cloudinary_public_id
                )
             VALUES (?, ?, ?)`,
             [produtoId, urlImagem, publicId]
        );

        const[imagemCriada] = await db.execute(
            `SELECT * FROM produto_imagens
            WHERE  id = ?`,
            [resultado.insertId]
        );

        res.status(201).json ({
            mensagem:'Imagem adicionada ao produto com sucesso',
            imagem: imagemCriada[0]
        });

    } catch (erro) {

        if (imagemCloudinary?.public_id) {
            
            try {
                await cloudinary.uploader.destroy(
                    imagemCloudinary.public_id
                );
            } catch (erroCloudinary) {
                console.error(
                    'Erro ao limpar imagem do Cloudinary:', erroCloudinary.message
                );
            }
        }

        console.error(
            'Erro ao adicionar imagem ao produto:',erro.message
        );

        res.status(500).json({
            mensagem: 'Erro ao adicionar imagem ao produto'
        });
    }

});

app.delete(
    '/produtos/:produtoId/imagens/:imagemId',
    autenticarAdmin,
    async (req, res) => {

        const produtoId =
            Number(req.params.produtoId);

        const imagemId =
            Number(req.params.imagemId);


        if (
            !Number.isInteger(produtoId) ||
            produtoId <= 0 ||
            !Number.isInteger(imagemId) ||
            imagemId <= 0
        ) {

            return res.status(400).json({
                mensagem: 'ID inválido'
            });

        }


        let conexao = null;


        try {

            conexao =
                await db.getConnection();


            await conexao.beginTransaction();


            const [imagens] =
                await conexao.execute(
                    `SELECT *
                     FROM produto_imagens
                     WHERE id = ?
                     AND produto_id = ?
                     FOR UPDATE`,
                    [
                        imagemId,
                        produtoId
                    ]
                );


            if (imagens.length === 0) {

                await conexao.rollback();

                return res.status(404).json({
                    mensagem:
                        'Imagem não encontrada'
                });

            }


            const imagem =
                imagens[0];


            /*
              Primeiro remove do banco.
            */

            await conexao.execute(
                `DELETE FROM produto_imagens
                 WHERE id = ?
                 AND produto_id = ?`,
                [
                    imagemId,
                    produtoId
                ]
            );


            /*
              Se era a principal,
              escolhe outra imagem.
            */

            if (Number(imagem.principal) === 1) {

                const [restantes] =
                    await conexao.execute(
                        `SELECT id
                         FROM produto_imagens
                         WHERE produto_id = ?
                         ORDER BY ordem ASC, id ASC
                         LIMIT 1`,
                        [produtoId]
                    );


                if (restantes.length > 0) {

                    await conexao.execute(
                        `UPDATE produto_imagens
                         SET principal = TRUE
                         WHERE id = ?`,
                        [
                            restantes[0].id
                        ]
                    );

                }

            }


            await conexao.commit();


            /*
              Depois do banco confirmado,
              remove o arquivo físico.
            */

            if (imagem.cloudinary_public_id) {

                try {

                    await cloudinary.uploader.destroy(
                        imagem.cloudinary_public_id
                    );

                } catch (erroCloudinary) {

                    console.error(
                        'Imagem removida do banco, mas houve erro no Cloudinary:',
                        erroCloudinary.message
                    );

                }

            } else {

                try {

                    const nomeArquivo =
                        path.basename(
                            imagem.url
                        );


                    const caminhoArquivo =
                        path.join(
                            __dirname,
                            'uploads',
                            nomeArquivo
                        );


                    await fs.unlink(
                        caminhoArquivo
                    );

                } catch (erroArquivo) {

                    if (
                        erroArquivo.code !==
                        'ENOENT'
                    ) {

                        console.error(
                            'Erro ao remover arquivo local:',
                            erroArquivo.message
                        );

                    }

                }

            }


            return res.json({
                mensagem:
                    'Imagem excluída com sucesso'
            });


        } catch (erro) {

            if (conexao) {

                try {

                    await conexao.rollback();

                } catch {}

            }


            console.error(
                'Erro ao excluir imagem:',
                erro
            );


            return res.status(500).json({
                mensagem:
                    'Erro ao excluir imagem'
            });


        } finally {

            if (conexao) {

                conexao.release();

            }

        }

    }
);



app.get('/admin/produtos/:id/variacoes', autenticarAdmin, async (req, res) => {

    const produtoId = Number(req.params.id);

    if(!Number.isInteger(produtoId) || produtoId <= 0) {
        return res.status(400).json ({
            mensagem: 'ID do produto inválido'
        });
    }

    try {

        const [variacoes] = await db.execute (
            `SELECT *
             FROM produto_variacoes
             WHERE produto_id = ?
             ORDER BY cor ASC, tamanho ASC`,
             [produtoId]
        );

        res.json(variacoes);
    } catch (erro) {
        console.error(
            'Erro ao buscar variações administrativas:', erro.message
        );

        res.status(500).json ({
            mensagem: 'Erro ao buscar variações'
        });
    }
});


app.post('/produtos/:id/variacoes', autenticarAdmin, async (req, res) => {

    const produtoId = Number(req.params.id);

    const {
        tamanho,
        cor,
        estoque = 0,
        sku
    } = req.body;

    if(!Number.isInteger(produtoId) || produtoId <= 0) {
        return res.status(400).json ({
            mensagem: 'ID do produto inválido'
        });
    }

    if (
        !tamanho || !cor || estoque == null || !sku
    ) {
        return res.status(400).json({
            mensagem: 'Tamanho, cor, estoque e SKU são obrigatórios'
        });
    }

    const estoqueNumero = Number(estoque);

    if(!Number.isInteger(estoqueNumero) || estoqueNumero < 0){
        return res.status(400).json({
            mensagem: 'Estoque deve ser um número inteiro maior ou igual a zero'
        });
    }

    try {

        const [produtos] = await db.execute(
            `SELECT id
             FROM produtos
             WHERE id = ?`,
             [produtoId]
        );

        if (produtos.length === 0){
            return res.status(404).json ({
                mensagem: 'Produto não encontrado'
            });
        }

        const [resultado] = await db.execute (
            `INSERT INTO produto_variacoes
                (
                    produto_id,
                    tamanho,
                    cor,
                    estoque,
                    sku
                ) 
                VALUES (?, ?, ?, ?, ?)`,
                [
                    produtoId,
                    tamanho.trim(),
                    cor.trim(),
                    estoqueNumero,
                    sku.trim()
                ]
        );

        const [variacaoCriada] = await db.execute(
            `SELECT *
             FROM produto_variacoes
             WHERE id = ?`,
             [resultado.insertId]
        );

        res.status(201).json(variacaoCriada[0]);
    } catch (erro) {

    console.error(
        'Erro ao cadastrar variação:',
        erro.message
    );

    if (erro.code === 'ER_DUP_ENTRY') {

        if (erro.message.includes('uq_produto_tamanho_cor')) {
            return res.status(409).json({
                mensagem: `Já existe uma variação ${tamanho} / ${cor} para este produto`
            });
        }

        if (erro.message.toLowerCase().includes('sku')) {
            return res.status(409).json({
                mensagem: 'Este SKU já está sendo utilizado'
            });
        }

        return res.status(409).json({
            mensagem: 'Já existe uma variação com esses dados'
        });
    }

    res.status(500).json({
        mensagem: 'Erro interno ao cadastrar variação'
    });
} 
});

app.put('/produtos/:produtoId/variacoes/:variacaoId', autenticarAdmin, async (req, res) => {

    const produtoId = Number(req.params.produtoId);
    const variacaoId = Number(req.params.variacaoId);

    const{
        tamanho,
        cor,
        estoque,
        sku,
        ativo
    } = req.body;

    if (
        !Number.isInteger(produtoId) ||
        produtoId <= 0 ||
        !Number.isInteger(variacaoId) ||
        variacaoId <= 0
    ) {
        return res.status(400).json({
            mensagem:'ID inválido'
        });
    }

    if(
        !tamanho ||
        !cor ||
        estoque == null ||
        !sku ||
        ativo == null
    ) {
        return res.status(400).json({
            mensagem: 'Dados obrigatórios não informados'
        });
    }

    const estoqueNumero = Number(estoque);

    if(
        !Number.isInteger(estoqueNumero)|| estoqueNumero < 0)
    {
        return res.status(400).json({
            mensagem: 'Estoque deve ser um número inteiro maior ou igual a zero'
        });
    }

    try {

        const [resultado] = await db.execute(
            `UPDATE produto_variacoes
             SET
                tamanho = ?,
                cor = ?,
                estoque = ?,
                sku = ?,
                ativo = ?
            WHERE id = ?
            AND produto_id = ?`,
            [
                tamanho.trim(),
                cor.trim(),
                estoqueNumero,
                sku.trim(),
                ativo,
                variacaoId,
                produtoId
            ]
        );

        if (resultado.affectedRows === 0){
            return res.status(404).json({
                mensagem:'Variação não encontrada'
            });
        }

        const [variacaoAtualizada] = await db.execute(
            `SELECT *
             FROM produto_variacoes
             WHERE id = ?
             AND produto_id = ?`,
             [variacaoId, produtoId]
        );

        res.json(variacaoAtualizada[0]);
    } catch (erro) {
        console.error(
            'Erro ao atualizar variação:', erro.message
        );

        res.status(500).json({
            mensagem:'Erro ao atualizar variação'
        });
    }
});

app.delete('/produtos/:produtoId/variacoes/:variacaoId', autenticarAdmin, async (req, res) => {

    const produtoId = Number(req.params.produtoId);
    const variacaoId = Number(req.params.variacaoId);

    if (
        !Number.isInteger(produtoId) ||
        produtoId <= 0 ||
        !Number.isInteger(variacaoId) ||
        variacaoId <= 0
    ) {
        return res.status(400).json ({
            mensagem:'ID inválido'
        });
    }

    try {

        const [resultado] = await db.execute(
            `UPDATE produto_variacoes
             SET ativo = FALSE
             WHERE id = ?
             AND produto_id = ?`,
             [variacaoId, produtoId]
        );

        if (resultado.affectedRows === 0){
            return res.status(404).json({
                mensagem:'Variação não encontrada'
            });
        }
        res.json({
            mensagem:'Variação desativada com sucesso'
        });
    } catch (erro) {
        console.error(
        'Erro ao desativar variação', erro.message
    );

    res.status(500).json({
        mensagem:'Erro ao desativar variação'
    });
}
});

app.patch('/produtos/:produtoId/variacoes/:variacaoId/reativar', autenticarAdmin, async (req, res) => {
   
    const produtoId = Number(req.params.produtoId);
    const variacaoId = Number(req.params.variacaoId);

    if (
        !Number.isInteger(produtoId)||
        produtoId <= 0 ||
        !Number.isInteger(variacaoId)||
        variacaoId <= 0
    ) {
        return res.status(400).json ({
            mensagem: 'ID inválido'
        });
    }

    try {

        const [resultado] = await db.execute(
            `UPDATE produto_variacoes
             SET ativo = TRUE
             WHERE id = ?
             AND produto_id = ?`,
             [variacaoId, produtoId]
        );

        if (resultado.affectedRows === 0) {
            return res.status(404).json({
                mensagem: 'Variação não encontrada'
            });
        }

        const [variacaoReativada] = await db.execute(
            `SELECT *
             FROM produto_variacoes
             WHERE id = ?
             AND produto_id = ?`,
             [variacaoId, produtoId]
        );

        res.json({
            mensagem: 'Variação reativada com sucesso', 
            variacao: variacaoReativada[0]
        });
    } catch (erro) {
        console.error(
            'Erro ao reativar variação:',erro.message
        );

        res.status(500).json({
            mensagem: 'Erro ao reativar variação'
        });
    }
});

app.patch('/produtos/:produtoId/variacoes/:variacaoId/estoque', autenticarAdmin ,async (req, res) => {

    const produtoId = Number(req.params.produtoId);
    const variacaoId = Number(req.params.variacaoId);

    const { estoque } = req.body;

    if(
        !Number.isInteger(produtoId) ||
        produtoId <= 0 ||
        !Number.isInteger(variacaoId) ||
        variacaoId <= 0
    ) {
        return res.status(400).json({
            mensagem: 'ID inválido'
        });
    }

    if (estoque == null) {
        return res.status(400).json({
            mensagem:'Estoque é obrigatório'
        });
    }

    const estoqueNumero = Number(estoque);

    if(
        !Number.isInteger(estoqueNumero)|| estoqueNumero < 0
    ) {
        return res.status(400).json({
            mensagem: 'Estoque deve ser um número inteiro maior ou igual a zero'
        });
    }

    try {

        const [resultado] = await db.execute(
            `UPDATE produto_variacoes
             SET estoque = ?
             WHERE id = ?
             AND produto_id = ?`,
             [estoqueNumero, variacaoId, produtoId]
        );

        if (resultado.affectedRows === 0){
            return res.status(404).json({
                mensagem: 'Variação não encontrada'
            });
        }

        const [variacaoAtualizada] = await db.execute(
            `SELECT * FROM produto_variacoes
             WHERE id = ?
             AND produto_id = ?`,
             [variacaoId, produtoId]
        );

        res.json({
            mensagem: 'Estoque atualizado com sucesso', variacao: variacaoAtualizada[0]
        });        
    } catch (erro) {
        console.error(
            'Erro ao atualizar estoque:',erro.message
        );
        res.status(500).json({
            mensagem:'Erro ao atualizar estoque'
        });
     }
    
    
});


app.get('/admin/campanhas', autenticarAdmin, async (req, res) => {

    try {

        const [campanhas] = await db.execute(
            `SELECT *
            FROM campanhas
            ORDER BY atualizado_em DESC`
        );

        res.json(campanhas);
    } catch(erro) {
        console.error(
            'Erro ao buscar campanhas administrativas:', erro.message
        );

        res.status(500).json ({
            mensagem:'Erro ao buscar campanhas'
        });
    }
});

app.post(
    '/admin/campanhas',
    autenticarAdmin,
    uploadCloud.single('imagem'),
    async (req, res) => {

        const {
            titulo,
            subtitulo = null,
            texto_botao = null,
            link_botao = null,
            ativo = false
        } = req.body;

        // Valida título
        if (!titulo || !titulo.trim()) {
            return res.status(400).json({
                mensagem: 'Título da campanha é obrigatório'
            });
        }

        // Valida imagem
        if (!req.file) {
            return res.status(400).json({
                mensagem: 'Imagem da campanha é obrigatória'
            });
        }

        // Como multipart/form-data envia strings,
        // transformamos ativo em boolean
        const campanhaAtiva =
            String(ativo).toLowerCase() === 'true' ||
            String(ativo) === '1';

        let imagemCloudinary = null;
        let connection = null;

        try {

            // ============================
            // 1. ENVIA PARA O CLOUDINARY
            // ============================

            imagemCloudinary = await enviarImagemCloudinary(
                req.file.buffer,
                'haze-drip/campanhas'
            );

            const imagemUrl =
                imagemCloudinary.secure_url;

            const publicId =
                imagemCloudinary.public_id;


            // ============================
            // 2. ABRE CONEXÃO MYSQL
            // ============================

            connection = await db.getConnection();

            await connection.beginTransaction();


            // ============================
            // 3. SE A NOVA FOR ATIVA,
            // DESATIVA AS OUTRAS
            // ============================

            if (campanhaAtiva) {

                await connection.execute(
                    `UPDATE campanhas
                     SET ativo = FALSE
                     WHERE ativo = TRUE`
                );

            }


            // ============================
            // 4. CADASTRA A CAMPANHA
            // ============================

            const [resultado] =
                await connection.execute(
                    `INSERT INTO campanhas
                    (
                        titulo,
                        subtitulo,
                        imagem_url,
                        cloudinary_public_id,
                        texto_botao,
                        link_botao,
                        ativo
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        titulo.trim(),

                        subtitulo
                            ? subtitulo.trim()
                            : null,

                        imagemUrl,

                        publicId,

                        texto_botao
                            ? texto_botao.trim()
                            : null,

                        link_botao
                            ? link_botao.trim()
                            : null,

                        campanhaAtiva
                    ]
                );


            // ============================
            // 5. BUSCA CAMPANHA CRIADA
            // ============================

            const [campanhaCriada] =
                await connection.execute(
                    `SELECT *
                     FROM campanhas
                     WHERE id = ?`,
                    [resultado.insertId]
                );


            // ============================
            // 6. CONFIRMA TRANSACTION
            // ============================

            await connection.commit();


            // ============================
            // 7. RESPOSTA
            // ============================

            res.status(201).json({
                mensagem:
                    'Campanha cadastrada com sucesso',

                campanha:
                    campanhaCriada[0]
            });


        } catch (erro) {

            // ============================
            // DESFAZ MYSQL
            // ============================

            if (connection) {

                try {
                    await connection.rollback();
                } catch (erroRollback) {
                    console.error(
                        'Erro no rollback:',
                        erroRollback.message
                    );
                }

            }


            // ============================
            // REMOVE IMAGEM DO CLOUDINARY
            // SE O MYSQL FALHAR
            // ============================

            if (imagemCloudinary?.public_id) {

                try {

                    await cloudinary.uploader.destroy(
                        imagemCloudinary.public_id
                    );

                } catch (erroCloudinary) {

                    console.error(
                        'Erro ao limpar imagem do Cloudinary:',
                        erroCloudinary.message
                    );

                }
            }


            console.error(
                'Erro ao cadastrar campanha:',
                erro.message
            );

            res.status(500).json({
                mensagem:
                    'Erro ao cadastrar campanha'
            });


        } finally {

            // ============================
            // LIBERA CONEXÃO MYSQL
            // ============================

            if (connection) {
                connection.release();
            }

        }
    }
);

app.patch('/admin/campanhas/:id/desativar', autenticarAdmin, async (req, res) => {

    const id = Number(req.params.id);

    if(!Number.isInteger(id) || id <= 0){
        return res.status(400).json({
            mensagem:'ID da campanha inválido'
        });
    }

    try {

        const [resultado] = await db.execute(
            `UPDATE campanhas
             SET ativo = FALSE
             WHERE id =?`,
             [id]
        );

        if (resultado.affectedRows === 0) {
            return res.status(404).json({
                mensagem: 'Campanha não encontrada'
            });
        }

        res.json({
            mensagem: 'Campanha desativada com sucesso'
        });
    } catch (erro) {
        console.error(
            'Erro ao desativar campanha:', erro.message
        );

        res.status(500).json({
            mensagem: 'Erro ao desativar campanha'
        });
    }
});

app.patch('/admin/campanhas/:id/ativar', autenticarAdmin, async (req, res) => {

    const id = Number(req.params.id);

    if(!Number.isInteger(id) || id <= 0) {
        return res.status(400).json ({
            mensagem: 'ID da campanha inválido'
        });
    }

    let connection;

    try {

        connection = await db.getConnection();

        await connection.beginTransaction();

        const [campanhas] = await connection.execute(
            `SELECT id
             FROM campanhas
             WHERE id = ?
             FOR UPDATE`,
             [id]
        );

        if (campanhas.length === 0){

            await connection.rollback();

            return res.status(404).json({
                mensagem: 'Campanha não encontrada'
            });
        }

        await connection.execute(
            `UPDATE campanhas
             SET ativo = FALSE
             WHERE ativo = TRUE`,
        );

        await connection.execute(
            `UPDATE campanhas
             SET ativo = TRUE
             WHERE id = ?`,
             [id]
        );

        const [campanhaAtivada] = await connection.execute(
            `SELECT * FROM campanhas
             WHERE id = ?`,
             [id]
        );

        await connection.commit();

        res.json({
            mensagem:'Campanha ativada com sucesso',
            campanha: campanhaAtivada[0]
        });
    } catch (erro) {
        if (connection) {
            await connection.rollback();
        }
        console.error(
            'Erro ao tivar campanha:', erro.message
        );

        res.status(500).json({
            mensagem: 'Erro ao ativar campanha'
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});
    
app.get ('/destaques', async (req, res) => {

    try {

        const [produtos] = await db.execute(`
            SELECT
                p.*,
                c.nome AS categoria_nome,

                (
                    SELECT pi.url
                    FROM produto_imagens pi
                    WHERE pi.produto_id = p.id
                    AND pi.principal = TRUE
                    LIMIT 1
                ) AS imagem_principal

                FROM produtos p

                LEFT JOIN categorias c
                    ON c.id = p.categoria_id
                
                WHERE p.ativo = TRUE
                AND p.destaque_home = TRUE

                ORDER BY p.criado_em DESC
            `);

            res.json(produtos);
    } catch(erro) {
        console.error(
            'Erro ao buscar destaques:', erro.message
        );

        res.status(500).json ({
            mensagem: 'Erro ao buscar produtos em destaque'
        });
    }
});

app.patch('/admin/produtos/:id/destaque', autenticarAdmin, async (req, res) => {

    const id = Number(req.params.id);

    const { destaque_home } = req.body;

    if(!Number.isInteger(id) || id <= 0) {
        return res.status(400).json ({
            mensagem: 'ID do produto inválido'
        });
    }

    if (destaque_home == null){
        return res.status(400).json({
            mensagem: 'Status de destaque é obrigatório'
        });
    }

    if (typeof destaque_home !== 'boolean') {
        return res.status(400).json ({
            mensagem: 'destaque_home deve ser true ou false'
        });
    }

    try {

        const [resultado] = await db.execute(
            `UPDATE produtos
             SET destaque_home = ?
             WHERE id = ?`,
             [destaque_home, id]
        );

        if (resultado.affectedRows === 0) {
            return res.status(404).json({
                mensagem: 'Produto não encontrado'
            });
        }

        const [produtoAtualizado] = await db.execute(
            `SELECT 
                p.*,
                c.nome AS categoria_nome
                FROM produtos p
                
                LEFT JOIN categorias c 
                    ON c.id = p.categoria_id
                    WHERE p.id = ?`,
                    [id]
        );

        res.json({
            mensagem: destaque_home
            ? 'Produto adicionado aos destaques': 'Produto removido dos destaques', produto: produtoAtualizado[0]
        });
    } catch (erro) {
        console.error(
            'ERRO COMPLETO DO DESTAQUE:',erro.message
        );

        res.status(500).json ({
            mensagem: 'Erro ao alterar destaque do produto'
        });
    }
});

app.put(
    '/admin/campanhas/:id',
    autenticarAdmin,
    uploadCloud.single('imagem'),
    async (req, res) => {

        const id = Number(req.params.id);

        const {
            titulo,
            subtitulo = null,
            texto_botao = null,
            link_botao = null,
            ativo = false
        } = req.body;

        // ============================
        // 1. VALIDAÇÕES
        // ============================

        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({
                mensagem: 'ID da campanha inválido'
            });
        }

        if (!titulo || !titulo.trim()) {
            return res.status(400).json({
                mensagem: 'Título da campanha é obrigatório'
            });
        }

        const campanhaAtiva =
            String(ativo).toLowerCase() === 'true' ||
            String(ativo) === '1';


        let connection = null;

        // Guarda informações da NOVA imagem
        let novaImagemCloudinary = null;

        // Guarda informações da imagem ANTIGA
        let publicIdAntigo = null;


        try {

            // ============================
            // 2. ABRE TRANSACTION
            // ============================

            connection = await db.getConnection();

            await connection.beginTransaction();


            // ============================
            // 3. PROCURA CAMPANHA ATUAL
            // ============================

            const [campanhas] =
                await connection.execute(
                    `SELECT *
                     FROM campanhas
                     WHERE id = ?
                     FOR UPDATE`,
                    [id]
                );


            if (campanhas.length === 0) {

                await connection.rollback();

                return res.status(404).json({
                    mensagem: 'Campanha não encontrada'
                });
            }


            const campanhaAtual = campanhas[0];


            // Inicialmente mantém a imagem atual
            let imagemUrl =
                campanhaAtual.imagem_url;

            let publicId =
                campanhaAtual.cloudinary_public_id;


            // ============================
            // 4. SE ENVIOU IMAGEM NOVA
            // ============================

            if (req.file) {

                novaImagemCloudinary =
                    await enviarImagemCloudinary(
                        req.file.buffer,
                        'haze-drip/campanhas'
                    );


                imagemUrl =
                    novaImagemCloudinary.secure_url;

                publicId =
                    novaImagemCloudinary.public_id;


                // Guarda o ID antigo para apagar depois
                publicIdAntigo =
                    campanhaAtual.cloudinary_public_id;
            }


            // ============================
            // 5. SE FOR ATIVAR ESTA
            // DESATIVA AS OUTRAS
            // ============================

            if (campanhaAtiva) {

                await connection.execute(
                    `UPDATE campanhas
                     SET ativo = FALSE
                     WHERE id <> ?
                     AND ativo = TRUE`,
                    [id]
                );

            }


            // ============================
            // 6. ATUALIZA CAMPANHA
            // ============================

            await connection.execute(
                `UPDATE campanhas
                 SET
                    titulo = ?,
                    subtitulo = ?,
                    imagem_url = ?,
                    cloudinary_public_id = ?,
                    texto_botao = ?,
                    link_botao = ?,
                    ativo = ?
                 WHERE id = ?`,
                [
                    titulo.trim(),

                    subtitulo
                        ? subtitulo.trim()
                        : null,

                    imagemUrl,

                    publicId,

                    texto_botao
                        ? texto_botao.trim()
                        : null,

                    link_botao
                        ? link_botao.trim()
                        : null,

                    campanhaAtiva,

                    id
                ]
            );


            // ============================
            // 7. BUSCA CAMPANHA ATUALIZADA
            // ============================

            const [campanhaAtualizada] =
                await connection.execute(
                    `SELECT *
                     FROM campanhas
                     WHERE id = ?`,
                    [id]
                );


            // ============================
            // 8. CONFIRMA MYSQL
            // ============================

            await connection.commit();


            // ============================
            // 9. APAGA IMAGEM ANTIGA
            // ============================

            if (
                req.file &&
                publicIdAntigo &&
                publicIdAntigo !== publicId
            ) {

                try {

                    await cloudinary.uploader.destroy(
                        publicIdAntigo
                    );

                } catch (erroCloudinary) {

                    console.error(
                        'Campanha atualizada, mas houve erro ao excluir imagem antiga:',
                        erroCloudinary.message
                    );

                }
            }


            // ============================
            // 10. RESPOSTA
            // ============================

            res.json({
                mensagem:
                    'Campanha atualizada com sucesso',

                campanha:
                    campanhaAtualizada[0]
            });


        } catch (erro) {

            // ============================
            // DESFAZ MYSQL
            // ============================

            if (connection) {

                try {
                    await connection.rollback();
                } catch (erroRollback) {
                    console.error(
                        'Erro no rollback:',
                        erroRollback.message
                    );
                }

            }


            // ============================
            // SE A NOVA IMAGEM SUBIU,
            // MAS O MYSQL FALHOU,
            // APAGA A NOVA IMAGEM
            // ============================

            if (novaImagemCloudinary?.public_id) {

                try {

                    await cloudinary.uploader.destroy(
                        novaImagemCloudinary.public_id
                    );

                } catch (erroCloudinary) {

                    console.error(
                        'Erro ao limpar nova imagem do Cloudinary:',
                        erroCloudinary.message
                    );

                }
            }


            console.error(
                'Erro ao atualizar campanha:',
                erro.message
            );


            res.status(500).json({
                mensagem:
                    'Erro ao atualizar campanha'
            });


        } finally {

            // ============================
            // LIBERA CONEXÃO
            // ============================

            if (connection) {
                connection.release();
            }

        }

    }
);

app.delete('/admin/campanhas/:id', autenticarAdmin, async (req, res) => {

    const id = Number(req.params.id);

    if(!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
            mensagem: 'ID da campanha inválido'
        });
    }

    try {

        const [resultado] = await db.execute (
            `UPDATE campanhas
             SET ativo = FALSE
             WHERE id = ?`,
             [id]
        );

        if (resultado.affectedRows === 0){
            return res.status(404).json({
                mensagem: 'Campanha não encontrada'
            });
        }

        res.json({
            mensagem: 'Campanha desativada com sucesso'
        });
    } catch(erro) {
        console.error(
            'Erro ao desativar campanha:', erro.message
        );

        res.status(500).json({
            mensagem: 'Erro ao desativar campanha'
        });
    }

});

app.patch('/admin/campanhas/:id/ativar', autenticarAdmin, async (req, res) => {

    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
            mensagem: 'ID da campanha inválido'
        });
    }

    let connection;

    try {

        connection = await db.getConnection();

        await connection.beginTransaction();

        const [campanhas] = await connection.execute(
            `SELECT id FROM campanhas
             WHERE id = ?`,
             [id]
        );

        if (campanhas.length === 0) {
            await connection.rollback();

            return res.status(404).json({
                mensagem: 'Campanha não encontrada'
            });
        }

        // Desativa todas
        await connection.execute (
            `UPDATE campanhas
             SET ativo = FALSE`
        );

        // Ativa somente a escolhida
        await connection.execute(
            `UPDATE campanhas 
             SET ativo = TRUE
             WHERE id = ?`,
            [id]
        );

        const [campanhaAtivada] = await connection.execute(
            `SELECT * FROM campanhas
             WHERE if = ?`,
             [id]
        );

        await connection.commit();

        res.json({
            mensagem: 'Campanha ativada com sucesso',
            campanha: campanhaAtivada[0]
        });

    } catch (erro) {
        if (connection) {
            await connection.rollback();
        }
        console.error(
            'Erro ao ativar campanha:',erro.message
        );

        res.status(500).json({
            mensagem: 'Erro ao ativar campanha'
        });

    } finally {
        if (connection) {
            connection.release();
        }
    }
});

app.patch('/admin/produtos/:id/destaque', async (req, res) => {

    const id = Number(req.params.id);

    const { destaque_home } = req.body;

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
            mensagem: 'ID do produto inválido'
        });
    }

    if (destaque_home == null) {
        return res.status(400).json({
            mensagem: 'Status de destaque é obrigatório'
        });
    }

    const destaque =
        destaque_home === true ||
        destaque_home === 1 ||
        destaque_home === '1' ||
        String(destaque_home).toLowerCase() === 'true';

    try {

        const [resultado] = await db.execute(
            `UPDATE produtos
             SET destaque_home = ?
             WHERE id = ?`,
            [destaque, id]
        );

        if (resultado.affectedRows === 0) {
            return res.status(404).json({
                mensagem: 'Produto não encontrado'
            });
        }

        const [produto] = await db.execute(
            `SELECT
                id,
                nome,
                destaque_home
             FROM produtos
             WHERE id = ?`,
            [id]
        );

        res.json({
            mensagem: destaque
                ? 'Produto adicionado aos destaques'
                : 'Produto removido dos destaques',

            produto: produto[0]
        });

    } catch (erro) {

        console.error(
            'Erro ao alterar destaque do produto:',
            erro.message
        );

        res.status(500).json({
            mensagem: 'Erro ao alterar destaque do produto'
        });
    }
});

// TRATAMENTO GLOBAL DE ERROS
app.use((erro, req, res, next) => {

    if (erro instanceof multer.MulterError) {

        if (erro.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                mensagem: 'A imagem deve ter no máximo 5 MB'
            });
        }

        return res.status(400).json({
            mensagem: 'Erro ao enviar imagem'
        });
    }

    if (
        erro.message ===
        'Apenas imagens JPG, PNG ou WEBP são permitidas'
    ) {
        return res.status(400).json({
            mensagem: erro.message
        });
    }

    console.error(
        'Erro não tratado:',
        erro.message
    );

    res.status(500).json({
        mensagem: 'Erro interno do servidor'
    });
});

//rota de teste imagens online

app.post(
    '/admin/teste-cloudinary',
    autenticarAdmin,
    uploadCloud.single('imagem'),
    async (req, res) => {

        if (!req.file) {
            return res.status(400).json({
                mensagem: 'Nenhuma imagem enviada'
            });
        }

        try {

            const resultado = await enviarImagemCloudinary(
                req.file.buffer,
                'haze-drip/testes'
            );

            res.status(201).json({
                mensagem: 'Imagem enviada para Cloudinary com sucesso',
                url: resultado.secure_url,
                public_id: resultado.public_id
            });

        } catch (erro) {

            console.error(
                'ERRO COMPLETO CLOUDINARY:',
                erro.message
            );

            res.status(500).json({
                mensagem: 'Erro ao enviar imagem para Cloudinary'
            });
        }
    }
);

/* =============================================================
   ADMIN - LISTAR PEDIDOS
============================================================= */

app.get(
  '/admin/pedidos',
  autenticarAdmin,
  async (req, res) => {

    try {

      const [pedidos] =
        await db.execute(
          `SELECT
              id,
              status,
              cliente_nome,
              cliente_email,
              cliente_telefone,
              subtotal,
              frete,
              total
           FROM pedidos
           ORDER BY id DESC`
        );


      res.json(pedidos);


    } catch (erro) {

      console.error(
        'Erro ao buscar pedidos administrativos:',
        erro.message
      );


      res.status(500).json({
        mensagem:
          'Erro ao buscar pedidos'
      });

    }

  }
);

/* =============================================================
   ADMIN - DETALHES DE UM PEDIDO
============================================================= */

app.get(
  '/admin/pedidos/:id',
  autenticarAdmin,
  async (req, res) => {

    const pedidoId =
      Number(req.params.id);


    if (
      !Number.isInteger(pedidoId) ||
      pedidoId <= 0
    ) {

      return res.status(400).json({
        mensagem:
          'ID do pedido inválido'
      });

    }


    try {

      /* BUSCAR PEDIDO */

      const [pedidos] =
        await db.execute(
          `SELECT
              id,
              status,

              cliente_nome,
              cliente_email,
              cliente_telefone,

              endereco_cep,
              endereco_rua,
              endereco_numero,
              endereco_complemento,
              endereco_bairro,
              endereco_cidade,
              endereco_estado,

              subtotal,
              frete,
              total

           FROM pedidos

           WHERE id = ?`,
          [pedidoId]
        );


      if (pedidos.length === 0) {

        return res.status(404).json({
          mensagem:
            'Pedido não encontrado'
        });

      }


      /* BUSCAR ITENS */

      const [itens] =
        await db.execute(
          `SELECT
              pedido_id,
              produto_id,
              variacao_id,
              produto_nome,
              sku,
              cor,
              tamanho,
              preco_unitario,
              quantidade,
              subtotal

           FROM pedidos_itens

           WHERE pedido_id = ?`,
          [pedidoId]
        );


      return res.json({
        ...pedidos[0],
        itens
      });


    } catch (erro) {

      console.error(
        'Erro ao buscar pedido:',
        erro.message
      );


      return res.status(500).json({
        mensagem:
          'Erro ao buscar pedido'
      });

    }

  }
);

/* =============================================================
   ADMIN - ALTERAR STATUS DO PEDIDO
============================================================= */

app.patch( '/admin/pedidos/:id/status', autenticarAdmin,async (req, res) => {
  
    const pedidoId =
      Number(req.params.id);

    const {
      status
    } = req.body;


    if (
      !Number.isInteger(pedidoId) ||
      pedidoId <= 0
    ) {

      return res.status(400).json({
        mensagem:
          'ID do pedido inválido'
      });

    }


    try {

      /* =========================================================
         BUSCAR STATUS ATUAL
      ========================================================= */

      const [pedidos] =
        await db.execute(
          `SELECT
              id,
              status

           FROM pedidos

           WHERE id = ?`,
          [pedidoId]
        );


      if (pedidos.length === 0) {

        return res.status(404).json({
          mensagem:
            'Pedido não encontrado'
        });

      }


      const statusAtual =
        pedidos[0].status;


      /* =========================================================
         FLUXO PERMITIDO
      ========================================================= */

      const proximoStatus = {

        aguardando_pagamento:
          'pago',

        pago:
          'em_preparacao',

        em_preparacao:
          'enviado',

        enviado:
          'entregue'

      };


      /* =========================================================
         PEDIDOS FINALIZADOS
      ========================================================= */

      if (
        statusAtual === 'entregue'
      ) {

        return res.status(409).json({
          mensagem:
            'Pedido entregue não pode ter o status alterado'
        });

      }


      if (
        statusAtual === 'cancelado'
      ) {

        return res.status(409).json({
          mensagem:
            'Pedido cancelado não pode ter o status alterado'
        });

      }


      /* =========================================================
         VALIDAR PRÓXIMO STATUS
      ========================================================= */

      const statusEsperado =
        proximoStatus[statusAtual];


      if (
        status !== statusEsperado
      ) {

        return res.status(409).json({

          mensagem:
            `Alteração inválida. O próximo status deve ser: ${statusEsperado}`

        });

      }


      /* =========================================================
         ATUALIZAR
      ========================================================= */

      await db.execute(
        `UPDATE pedidos
         SET status = ?
         WHERE id = ?`,
        [
          status,
          pedidoId
        ]
      );


      return res.json({

        mensagem:
          'Status atualizado com sucesso',

        pedido: {

          id:
            pedidoId,

          status:
            status

        }

      });


    } catch (erro) {

      console.error(
        'Erro ao alterar status do pedido:',
        erro.message
      );


      return res.status(500).json({
        mensagem:
          'Erro ao alterar status do pedido'
      });

    }

  }
);


/* =============================================================
   ADMIN - CANCELAR PEDIDO E DEVOLVER ESTOQUE
============================================================= */

app.patch(
  '/admin/pedidos/:id/cancelar',
  autenticarAdmin,
  async (req, res) => {

    const pedidoId =
      Number(req.params.id);


    if (
      !Number.isInteger(pedidoId) ||
      pedidoId <= 0
    ) {

      return res.status(400).json({
        mensagem:
          'ID do pedido inválido'
      });

    }


    const conexao =
      await db.getConnection();


    try {

      await conexao.beginTransaction();


      /* =========================================================
         BLOQUEAR E BUSCAR PEDIDO
      ========================================================= */

      const [pedidos] =
        await conexao.execute(
          `SELECT
              id,
              status

           FROM pedidos

           WHERE id = ?

           FOR UPDATE`,
          [pedidoId]
        );


      if (pedidos.length === 0) {

        await conexao.rollback();

        return res.status(404).json({
          mensagem:
            'Pedido não encontrado'
        });

      }


      const pedido =
        pedidos[0];


      /* =========================================================
         IMPEDIR DUPLO CANCELAMENTO
      ========================================================= */

      if (
        pedido.status ===
        'cancelado'
      ) {

        await conexao.rollback();

        return res.status(409).json({
          mensagem:
            'Pedido já está cancelado'
        });

      }


      /* =========================================================
         STATUS QUE PODEM SER CANCELADOS
      ========================================================= */

      const statusCancelaveis = [
        'aguardando_pagamento',
        'pago',
        'em_preparacao'
      ];


      if (
        !statusCancelaveis.includes(
          pedido.status
        )
      ) {

        await conexao.rollback();

        return res.status(409).json({
          mensagem:
            'Este pedido não pode mais ser cancelado'
        });

      }


      /* =========================================================
         BUSCAR ITENS
      ========================================================= */

      const [itens] =
        await conexao.execute(
          `SELECT
              variacao_id,
              quantidade

           FROM pedidos_itens

           WHERE pedido_id = ?`,
          [pedidoId]
        );


      /* =========================================================
         DEVOLVER ESTOQUE
      ========================================================= */

      for (const item of itens) {

        const [resultadoEstoque] =
          await conexao.execute(
            `UPDATE produto_variacoes

             SET estoque =
                 estoque + ?

             WHERE id = ?`,
            [
              item.quantidade,
              item.variacao_id
            ]
          );


        if (
          resultadoEstoque
            .affectedRows === 0
        ) {

          throw new Error(
            `Variação ${item.variacao_id} não encontrada`
          );

        }

      }


      /* =========================================================
         CANCELAR PEDIDO
      ========================================================= */

      await conexao.execute(
        `UPDATE pedidos

         SET status = 'cancelado'

         WHERE id = ?`,
        [pedidoId]
      );


      await conexao.commit();


      return res.json({
        mensagem:
          'Pedido cancelado e estoque devolvido com sucesso',

        pedido: {
          id:
            pedidoId,

          status:
            'cancelado'
        }
      });


    } catch (erro) {

      await conexao.rollback();


      console.error(
        'Erro ao cancelar pedido:',
        erro.message
      );


      return res.status(500).json({
        mensagem:
          'Erro ao cancelar pedido'
      });


    } finally {

      conexao.release();

    }

  }
);



/* =============================================================
   ADMIN - DETALHES DE UM PEDIDO
============================================================= */

app.get(
  '/admin/pedidos/:id',
  autenticarAdmin,
  async (req, res) => {

    const pedidoId =
      Number(req.params.id);


    if (
      !Number.isInteger(pedidoId) ||
      pedidoId <= 0
    ) {

      return res.status(400).json({
        mensagem:
          'ID do pedido inválido'
      });

    }


    try {

      /* =========================================================
         BUSCAR PEDIDO
      ========================================================= */

      const [pedidos] =
        await db.execute(
          `SELECT
              id,
              status,

              cliente_nome,
              cliente_email,
              cliente_telefone,

              endereco_cep,
              endereco_rua,
              endereco_numero,
              endereco_complemento,
              endereco_bairro,
              endereco_cidade,
              endereco_estado,

              subtotal,
              frete,
              total

           FROM pedidos

           WHERE id = ?`,
          [pedidoId]
        );


      if (pedidos.length === 0) {

        return res.status(404).json({
          mensagem:
            'Pedido não encontrado'
        });

      }


      /* =========================================================
         BUSCAR ITENS
      ========================================================= */

      const [itens] =
        await db.execute(
          `SELECT
              pedido_id,
              produto_id,
              variacao_id,
              produto_nome,
              sku,
              cor,
              tamanho,
              preco_unitario,
              quantidade,
              subtotal

           FROM pedidos_itens

           WHERE pedido_id = ?`,
          [pedidoId]
        );


      /* =========================================================
         RESPOSTA
      ========================================================= */

      return res.json({
        ...pedidos[0],
        itens
      });


    } catch (erro) {

      console.error(
        'Erro ao buscar pedido:',
        erro.message
      );


      return res.status(500).json({
        mensagem:
          'Erro ao buscar pedido'
      });

    }

  }
);


app.post('/pedidos', async (req, res) => {

  const {
    cliente,
    endereco,
    itens
  } = req.body;


  // =========================================================
  // VALIDAÇÕES BÁSICAS
  // =========================================================

  if (
    !cliente ||
    !cliente.nome ||
    !cliente.email ||
    !cliente.telefone
  ) {

    return res.status(400).json({
      erro: 'Dados do cliente são obrigatórios'
    });

  }


  if (
    !endereco ||
    !endereco.cep ||
    !endereco.rua ||
    !endereco.numero ||
    !endereco.bairro ||
    !endereco.cidade ||
    !endereco.estado
  ) {

    return res.status(400).json({
      erro: 'Endereço incompleto'
    });

  }


  if (
    !Array.isArray(itens) ||
    itens.length === 0
  ) {

    return res.status(400).json({
      erro: 'O pedido precisa possuir pelo menos um item'
    });

  }


  const conexao = await db.getConnection();


  try {

    await conexao.beginTransaction();


    let subtotalPedido = 0;

    const itensValidados = [];


    // =========================================================
    // VALIDA CADA ITEM DIRETAMENTE NO BANCO
    // =========================================================

    for (const item of itens) {

      const produtoId =
        Number(item.produto_id);

      const variacaoId =
        Number(item.variacao_id);

      const quantidade =
        Number(item.quantidade);


      if (
        !Number.isInteger(produtoId) ||
        produtoId <= 0 ||
        !Number.isInteger(variacaoId) ||
        variacaoId <= 0 ||
        !Number.isInteger(quantidade) ||
        quantidade <= 0
      ) {

        const erro = new Error(
          'Item do pedido inválido'
        );

        erro.status = 400;

        throw erro;

      }


      const [resultado] =
        await conexao.query(
          `
          SELECT
            v.id AS variacao_id,
            v.produto_id,
            v.tamanho,
            v.cor,
            v.estoque,
            v.sku,
            v.ativo AS variacao_ativa,

            p.nome AS produto_nome,
            p.preco,
            p.ativo AS produto_ativo

          FROM produto_variacoes v

          INNER JOIN produtos p
            ON p.id = v.produto_id

          WHERE
            v.id = ?
            AND v.produto_id = ?

          FOR UPDATE
          `,
          [
            variacaoId,
            produtoId
          ]
        );


      if (resultado.length === 0) {

        const erro = new Error(
          'Produto ou variação não encontrada'
        );

        erro.status = 404;

        throw erro;

      }


      const produto =
        resultado[0];


      if (
        !Number(produto.produto_ativo) ||
        !Number(produto.variacao_ativa)
      ) {

        const erro = new Error(
          `${produto.produto_nome} não está disponível`
        );

        erro.status = 400;

        throw erro;

      }


      if (
        quantidade >
        Number(produto.estoque)
      ) {

        const erro = new Error(
          `Estoque insuficiente para ${produto.produto_nome} - ${produto.cor} / ${produto.tamanho}`
        );

        erro.status = 409;

        throw erro;

      }


      const precoUnitario =
        Number(produto.preco);


      const subtotalItem =
        precoUnitario * quantidade;


      subtotalPedido +=
        subtotalItem;


      itensValidados.push({

        produto_id:
          produto.produto_id,

        variacao_id:
          produto.variacao_id,

        produto_nome:
          produto.produto_nome,

        sku:
          produto.sku,

        cor:
          produto.cor,

        tamanho:
          produto.tamanho,

        preco_unitario:
          precoUnitario,

        quantidade:
          quantidade,

        subtotal:
          subtotalItem

      });

    }


    // =========================================================
    // FRETE
    // Por enquanto será zero.
    // =========================================================

    const frete = 0;

    const total =
      subtotalPedido + frete;


    // =========================================================
    // CRIA PEDIDO
    // =========================================================

    const [resultadoPedido] =
      await conexao.query(
        `
        INSERT INTO pedidos (
          status,

          cliente_nome,
          cliente_email,
          cliente_telefone,

          endereco_cep,
          endereco_rua,
          endereco_numero,
          endereco_complemento,
          endereco_bairro,
          endereco_cidade,
          endereco_estado,

          subtotal,
          frete,
          total
        )

        VALUES (
          'aguardando_pagamento',
          ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?
        )
        `,
        [
          cliente.nome.trim(),
          cliente.email.trim().toLowerCase(),
          cliente.telefone.trim(),

          endereco.cep.trim(),
          endereco.rua.trim(),
          endereco.numero.trim(),
          endereco.complemento
            ? endereco.complemento.trim()
            : null,
          endereco.bairro.trim(),
          endereco.cidade.trim(),
          endereco.estado.trim().toUpperCase(),

          subtotalPedido,
          frete,
          total
        ]
      );


    const pedidoId =
      resultadoPedido.insertId;


    // =========================================================
    // CRIA OS ITENS E BAIXA O ESTOQUE
    // =========================================================

    for (const item of itensValidados) {

      await conexao.query(
        `
        INSERT INTO pedidos_itens (
          pedido_id,
          produto_id,
          variacao_id,
          produto_nome,
          sku,
          cor,
          tamanho,
          preco_unitario,
          quantidade,
          subtotal
        )

        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          pedidoId,
          item.produto_id,
          item.variacao_id,
          item.produto_nome,
          item.sku,
          item.cor,
          item.tamanho,
          item.preco_unitario,
          item.quantidade,
          item.subtotal
        ]
      );


      await conexao.query(
        `
        UPDATE produto_variacoes

        SET estoque = estoque - ?

        WHERE id = ?
        `,
        [
          item.quantidade,
          item.variacao_id
        ]
      );

    }


    // =========================================================
    // CONFIRMA TUDO
    // =========================================================

    await conexao.commit();


    return res.status(201).json({

      mensagem:
        'Pedido criado com sucesso',

      pedido: {

        id:
          pedidoId,

        status:
          'aguardando_pagamento',

        subtotal:
          subtotalPedido,

        frete:
          frete,

        total:
          total

      }

    });


  } catch (erro) {

    await conexao.rollback();


    console.error(
      'Erro ao criar pedido:',
      erro
    );


    return res
      .status(erro.status || 500)
      .json({

        erro:
          erro.status
            ? erro.message
            : 'Erro interno ao criar pedido'

      });


  } finally {

    conexao.release();

  }

});

// SERVIDOR
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});

//Essa rota será usada no catálogo
app.get('/admin/categorias', autenticarAdmin, async (req, res) => {
    try {
        
        const [categorias] = await db.execute (`
            SELECT
                id,
                nome,
                ativo,
                criado_em
                FROM categorias
                ORDER BY nome ASC
            `);
            
            res.json(categorias);

    } catch(erro) {
        console.error(
            'Erro ao buscar categorias administrativas:',
            erro.message
        );

        res.status(500).json ({
            mensagem: 'Erro ao buscar categorias'
        });
    }
});

app.post('/categorias', autenticarAdmin, async (req,res) => {
    const { nome } = req.body;

    if (!nome || !nome.trim()){
        return res.status(400).json ({
            mensagem:'Nome da categoria é obrigatório'
        });
    }

    try {
        const [resultado] = await db.execute (
            `INSERT INTO categorias (nome)
            VALUES (?)`,
            [nome.trim()]
            );

            const [categoriaCriada] = await db.execute(
                `SELECT * FROM categorias
                 WHERE id = ?`,
                 [resultado.insertId]
            );

            res.status(201).json(categoriaCriada[0]);
    
        } catch (erro) {

    console.error(
        'Erro ao cadastrar categoria:',
        erro.message
    );

    if (erro.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({
            mensagem: 'Já existe uma categoria com esse nome'
        });
    }

    res.status(500).json({
        mensagem: 'Erro interno ao cadastrar categoria'
    });
}

});

//Editar categoria
app.put('/categorias/:id', autenticarAdmin, async (req,res) => {

    const id = Number(req.params.id);

    const { nome } = req.body;

    if (!Number.isInteger(id)) {
        return res.status(400).json({
            mensagem: 'ID inválido'
        });
    }

    if (!nome || !nome.trim()) {
        return res.status(400).json ({
            mensagem: 'Nome da categoria é obrigatório'
        });
    }

    try {

        const [resultado] = await db.execute(
            `UPDATE categorias
            SET nome = ?
            WHERE id = ?`,
            [nome.trim(),id]
        );

        if(resuldado.affectedRows === 0) {
            return res.status(404).json ({
                mensagem: 'Categoria não encontrada'
            });
        }

        const [categoriaAtualizada] = await db.execute(
            `SELECT * FROM categorias
            WHERE id = ?`,
            [id]
        );

        res.json(categoriaAtualizada[0]);
    } catch (erro) {

        console.error(
            'Erro ao atualizar categoria:',
            erro.message
        );

        res.status(500).json ({
            mensagem:'Erro ao atualizar categoria'
        });
    }   
});

app.delete('/categorias/:id', autenticarAdmin, async (req, res) => {

    const id = Number(req.params.id);

    if(!Number.isInteger(id)){
        return res.status(400).json({
            mensagem: 'ID inválido'
        });
    }

    try {

        const [resultado] = await db.execute(
            `UPDATE categorias
             SET ativo = FALSE
             WHERE id = ?`,
             [id]          
        );

        if (resultado.affectedRows === 0){
            return res.status(404).json({
                mensagem: 'Categoria não encontrada'
            });
        }

        res.json ({
            mensagem: 'Categoria desativada com sucesso'
        });
    } catch (erro) {
        console.error(
            'Erro ao desativar categoria:',
            erro.message
        );

        res.status(500).json({
            mensagem:'Erro ao desativar categoria'
        });
    }
});

app.patch('/categorias/:id/reativar', autenticarAdmin, async (req, res) => {

    const id = Number(req.params.id);

    if(!Number.isInteger(id)){
        return res.status(400).json ({
            mensagem: 'ID inválido'
        });
    }
    
    try {
        
        const [resultado] = await db.execute(
            `UPDATE categorias
             SET ativo = TRUE 
             WHERE id = ?`,
             [id]
        );

        if (resultado.affectedRows === 0){
            return res.status(404).json ({
                mensagem: 'Categoria não encontrada'
            });
        }

        res.json({
            mensagem: 'Categoria reativada com sucesso'
        });
    } catch (erro) {
         console.error(
            'Erro ao reativar categoria',
            erro.message
         );

         res.status(500).json({
            mensagem:'Erro ao reativar categoria'
         });
    }
});


app.patch(
    '/produtos/:produtoId/imagens/:imagemId/principal', autenticarAdmin, async (req, res) => {

        const produtoId = Number(req.params.produtoId);
        const imagemId = Number(req.params.imagemId);

        if (
            !Number.isInteger(produtoId) || produtoId <= 0 || !Number.isInteger(imagemId) || imagemId <= 0
        ) {
            return res.status(400).json({
                mensagem: 'ID inválido'
            });
        }

        try {

            const [imagemEncontrada] = await db.execute(
                `SELECT id
                 FROM produto_imagens
                 WHERE id = ?
                 AND produto_id = ?`,
                 [imagemId, produtoId]
            );

            if (imagemEncontrada.length === 0) {
                return res.status(404).json({
                    mensagem: 'Imagem não encontrada para este produto'
                });
            }

            await db.execute(
                `UPDATE produto_imagens
                 SET principal = (id = ?)
                 WHERE produto_id = ?`,
                 [imagemId, produtoId]
            );

            const [imagens] = await db.execute(
                `SELECT * FROM produto_imagens
                 WHERE produto_id = ?
                 ORDER BY principal DESC, ordem ASC, id ASC`,
                 [produtoId]
            );

            res.json({
                mensagem:'Imagem principal definida com sucesso',
                imagens: imagens
            });
        } catch (erro) {
            console.error(
                'Erro ao definir imagem principal',
                erro.mensagem
            );

            res.status(500).json({
                mensagem: 'Erro ao definir imagem principal'
            });
        }
    } 
);
