const { Router } = require('express');

const valida = require('../../utils/validacao');
const { requisicaoInvalida } = require('../../utils/erros');
const { autenticarAdmin } = require('../../middlewares/autenticacao');
const { uploadImagem } = require('../../middlewares/upload');
const campanhasService = require('../../services/campanhasService');

const router = Router();

const ID_CAMPANHA = 'ID da campanha inválido';


/*
  Links do botão: só caminhos relativos da loja ou http(s).
  Impede "javascript:" e outros esquemas perigosos no banner.
*/
function lerLink(valor) {

  const link = valida.texto(valor, 'Link do botão inválido', { max: 255, opcional: true });

  if (link && /^[a-z][a-z0-9+.-]*:/i.test(link) && !/^https?:\/\//i.test(link)) {
    throw requisicaoInvalida('Link do botão inválido');
  }

  return link;
}


/*
  Produtos participantes: lista de IDs (JSON ou "1,2,3", pois o
  formulário é multipart). Ausente = mantém os atuais.
*/
function lerProdutos(valor) {

  if (valor === undefined) {
    return undefined;
  }

  const lista = Array.isArray(valor)
    ? valor
    : String(valor).split(',').map(item => item.trim()).filter(Boolean);

  if (lista.length > 500) {
    throw requisicaoInvalida('Produtos demais na campanha');
  }

  return [...new Set(lista.map(item => valida.id(item, 'Produto inválido na campanha')))];
}


function lerCampanha(corpo) {

  const dados = corpo || {};

  const inicioEm = valida.data(dados.inicio_em, 'Data de início inválida', { opcional: true });
  const fimEm = valida.data(dados.fim_em, 'Data de fim inválida', { opcional: true });

  if (inicioEm && fimEm && fimEm <= inicioEm) {
    throw requisicaoInvalida('A data de fim deve ser depois do início');
  }

  const desconto = dados.desconto_percentual === undefined || dados.desconto_percentual === ''
    ? null
    : valida.dinheiro(dados.desconto_percentual, 'Desconto deve ser entre 1% e 90%', { min: 1, max: 90 });

  return {
    titulo: valida.texto(dados.titulo, 'Título da campanha é obrigatório', { max: 150 }),
    subtitulo: valida.texto(dados.subtitulo, 'Subtítulo inválido', { max: 500, opcional: true }),
    textoBotao: valida.texto(dados.texto_botao, 'Texto do botão inválido', { max: 60, opcional: true }),
    linkBotao: lerLink(dados.link_botao),
    ativo: valida.paraBoolean(dados.ativo),
    inicioEm,
    fimEm,
    descontoPercentual: desconto,
    produtoIds: lerProdutos(dados.produto_ids)
  };
}


router.get('/admin/campanhas', autenticarAdmin, async (req, res) => {
  res.json(await campanhasService.listarTodas());
});

router.post(
  '/admin/campanhas',
  autenticarAdmin,
  uploadImagem.single('imagem'),
  async (req, res) => {

    const dados = lerCampanha(req.body);

    if (!req.file) {
      throw requisicaoInvalida('Imagem da campanha é obrigatória');
    }

    const campanha = await campanhasService.criar(dados, req.file.buffer);

    res.status(201).json({
      mensagem: 'Campanha cadastrada com sucesso',
      campanha
    });
  }
);

router.put(
  '/admin/campanhas/:id',
  autenticarAdmin,
  uploadImagem.single('imagem'),
  async (req, res) => {

    const id = valida.id(req.params.id, ID_CAMPANHA);

    const campanha = await campanhasService.atualizar(
      id,
      lerCampanha(req.body),
      req.file ? req.file.buffer : null
    );

    res.json({
      mensagem: 'Campanha atualizada com sucesso',
      campanha
    });
  }
);

router.patch('/admin/campanhas/:id/desativar', autenticarAdmin, async (req, res) => {
  await campanhasService.desativar(valida.id(req.params.id, ID_CAMPANHA));
  res.json({ mensagem: 'Campanha desativada com sucesso' });
});

router.delete('/admin/campanhas/:id', autenticarAdmin, async (req, res) => {
  await campanhasService.desativar(valida.id(req.params.id, ID_CAMPANHA));
  res.json({ mensagem: 'Campanha desativada com sucesso' });
});

router.patch('/admin/campanhas/:id/ativar', autenticarAdmin, async (req, res) => {
  const campanha = await campanhasService.ativar(valida.id(req.params.id, ID_CAMPANHA));
  res.json({
    mensagem: 'Campanha ativada com sucesso',
    campanha
  });
});


module.exports = router;
