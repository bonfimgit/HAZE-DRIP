const { Router } = require('express');

const valida = require('../../utils/validacao');
const { requisicaoInvalida } = require('../../utils/erros');
const { autenticarAdmin } = require('../../middlewares/autenticacao');
const { uploadImagem } = require('../../middlewares/upload');
const produtosService = require('../../services/produtosService');
const imagensService = require('../../services/imagensService');
const variacoesService = require('../../services/variacoesService');
const estoqueService = require('../../services/estoqueService');
const avaliacoesService = require('../../services/avaliacoesService');

const router = Router();

const ID_PRODUTO = 'ID do produto inválido';
const ESTOQUE_INVALIDO = 'Estoque deve ser um número inteiro maior ou igual a zero';


function lerProduto(corpo, { edicao = false } = {}) {

  const {
    nome,
    descricao,
    preco,
    categoria_id: categoriaId,
    ativo,
    destaque_home: destaqueHome
  } = corpo || {};

  const dados = {
    nome: valida.texto(nome, 'Nome do produto é obrigatório', { max: 150 }),
    descricao: valida.texto(descricao, 'Descrição inválida', { max: 5000, opcional: true })
  };

  if (
    preco == null ||
    categoriaId == null ||
    (edicao && (ativo == null || destaqueHome == null))
  ) {
    throw requisicaoInvalida(
      edicao
        ? 'Dados obrigatórios não informados'
        : 'Preço e categoria são obrigatórios'
    );
  }

  dados.preco = valida.dinheiro(preco, 'Preço deve ser um número maior que zero');
  dados.categoriaId = valida.id(categoriaId, 'Categoria inválida ou inativa');
  dados.ativo = valida.paraBoolean(ativo);
  dados.destaqueHome = valida.paraBoolean(destaqueHome);

  return dados;
}


function lerVariacao(corpo, { edicao = false } = {}) {

  const { tamanho, cor, estoque = edicao ? undefined : 0, sku, ativo } = corpo || {};

  const obrigatorios = edicao
    ? 'Dados obrigatórios não informados'
    : 'Tamanho, cor, estoque e SKU são obrigatórios';

  const dados = {
    tamanho: valida.texto(tamanho, obrigatorios, { max: 20 }),
    cor: valida.texto(cor, obrigatorios, { max: 50 }),
    sku: valida.texto(sku, obrigatorios, { max: 80 })
  };

  valida.obrigatorio(estoque, obrigatorios);

  dados.estoque = valida.inteiro(estoque, ESTOQUE_INVALIDO, { min: 0, max: 1000000 });

  if (edicao) {
    valida.obrigatorio(ativo, obrigatorios);
    dados.ativo = valida.paraBoolean(ativo);
  }

  return dados;
}


function lerIds(params) {
  return {
    produtoId: valida.id(params.produtoId),
    variacaoId: valida.id(params.variacaoId)
  };
}


/* =============================================================
   PRODUTOS
============================================================= */

router.get('/admin/produtos', autenticarAdmin, async (req, res) => {
  res.json(await produtosService.listarTodos());
});

router.get('/admin/produtos/:id', autenticarAdmin, async (req, res) => {
  const produtoId = valida.id(req.params.id, ID_PRODUTO);
  res.json(await produtosService.buscarAdmin(produtoId));
});

router.post('/produtos', autenticarAdmin, async (req, res) => {
  const produto = await produtosService.criar(lerProduto(req.body));
  res.status(201).json(produto);
});

router.put('/produtos/:id', autenticarAdmin, async (req, res) => {
  const produtoId = valida.id(req.params.id, ID_PRODUTO);
  const produto = await produtosService.atualizar(
    produtoId,
    lerProduto(req.body, { edicao: true })
  );
  res.json(produto);
});

router.delete('/produtos/:id', autenticarAdmin, async (req, res) => {
  await produtosService.desativar(valida.id(req.params.id));
  res.json({ mensagem: 'Produto desativado com sucesso' });
});

router.patch('/produtos/:id/reativar', autenticarAdmin, async (req, res) => {
  const produto = await produtosService.reativar(valida.id(req.params.id));
  res.json({
    mensagem: 'Produto reativado com sucesso!',
    produto
  });
});

router.patch('/admin/produtos/:id/destaque', autenticarAdmin, async (req, res) => {

  const produtoId = valida.id(req.params.id, ID_PRODUTO);
  const { destaque_home: destaque } = req.body || {};

  if (destaque == null) {
    throw requisicaoInvalida('Status de destaque é obrigatório');
  }

  if (typeof destaque !== 'boolean') {
    throw requisicaoInvalida('destaque_home deve ser true ou false');
  }

  const produto = await produtosService.alterarDestaque(produtoId, destaque);

  res.json({
    mensagem: destaque
      ? 'Produto adicionado aos destaques'
      : 'Produto removido dos destaques',
    produto
  });
});


/* =============================================================
   IMAGENS
============================================================= */

router.post(
  '/produtos/:id/imagens',
  autenticarAdmin,
  uploadImagem.single('imagem'),
  async (req, res) => {

    const produtoId = valida.id(req.params.id, ID_PRODUTO);

    if (!req.file) {
      throw requisicaoInvalida('Nenhuma imagem enviada');
    }

    const imagem = await imagensService.adicionar(produtoId, req.file.buffer);

    res.status(201).json({
      mensagem: 'Imagem adicionada ao produto com sucesso',
      imagem
    });
  }
);

router.delete(
  '/produtos/:produtoId/imagens/:imagemId',
  autenticarAdmin,
  async (req, res) => {
    await imagensService.remover(
      valida.id(req.params.produtoId),
      valida.id(req.params.imagemId)
    );
    res.json({ mensagem: 'Imagem excluída com sucesso' });
  }
);

router.patch(
  '/produtos/:produtoId/imagens/:imagemId/principal',
  autenticarAdmin,
  async (req, res) => {
    const imagens = await imagensService.definirPrincipal(
      valida.id(req.params.produtoId),
      valida.id(req.params.imagemId)
    );
    res.json({
      mensagem: 'Imagem principal definida com sucesso',
      imagens
    });
  }
);


/* =============================================================
   VARIAÇÕES E ESTOQUE
============================================================= */

router.get('/admin/produtos/:id/variacoes', autenticarAdmin, async (req, res) => {
  const produtoId = valida.id(req.params.id, ID_PRODUTO);
  res.json(await variacoesService.listarTodas(produtoId));
});

router.post('/produtos/:id/variacoes', autenticarAdmin, async (req, res) => {
  const produtoId = valida.id(req.params.id, ID_PRODUTO);
  const variacao = await variacoesService.criar(
    produtoId,
    lerVariacao(req.body),
    req.admin.id
  );
  res.status(201).json(variacao);
});

router.put('/produtos/:produtoId/variacoes/:variacaoId', autenticarAdmin, async (req, res) => {
  const { produtoId, variacaoId } = lerIds(req.params);
  const variacao = await variacoesService.atualizar(
    produtoId,
    variacaoId,
    lerVariacao(req.body, { edicao: true }),
    req.admin.id
  );
  res.json(variacao);
});

router.delete('/produtos/:produtoId/variacoes/:variacaoId', autenticarAdmin, async (req, res) => {
  const { produtoId, variacaoId } = lerIds(req.params);
  await variacoesService.alterarAtivo(produtoId, variacaoId, false);
  res.json({ mensagem: 'Variação desativada com sucesso' });
});

router.patch('/produtos/:produtoId/variacoes/:variacaoId/reativar', autenticarAdmin, async (req, res) => {
  const { produtoId, variacaoId } = lerIds(req.params);
  const variacao = await variacoesService.alterarAtivo(produtoId, variacaoId, true);
  res.json({
    mensagem: 'Variação reativada com sucesso',
    variacao
  });
});

/*
  Ajuste de estoque.
  Corpo: { estoque } define o valor exato (ajuste/inventário)
     ou  { entrada } soma unidades recebidas.
  "motivo" é opcional e fica no histórico de movimentações.
*/
router.patch('/produtos/:produtoId/variacoes/:variacaoId/estoque', autenticarAdmin, async (req, res) => {

  const { produtoId, variacaoId } = lerIds(req.params);
  const { estoque, entrada, motivo, estoque_minimo: estoqueMinimo } = req.body || {};

  if (estoque == null && entrada == null && estoqueMinimo == null) {
    throw requisicaoInvalida('Estoque é obrigatório');
  }

  const motivoTexto = valida.texto(motivo, 'Motivo inválido', { max: 255, opcional: true });

  if (estoque != null || entrada != null) {

    const somar = entrada != null;

    await estoqueService.alterar({
      produtoId,
      variacaoId,
      modo: somar ? 'somar' : 'definir',
      valor: somar
        ? valida.inteiro(entrada, 'Entrada deve ser um número inteiro maior que zero', { min: 1, max: 1000000 })
        : valida.inteiro(estoque, ESTOQUE_INVALIDO, { min: 0, max: 1000000 }),
      motivo: motivoTexto || (somar ? 'Entrada de estoque' : 'Ajuste manual'),
      adminId: req.admin.id
    });
  }

  if (estoqueMinimo != null) {
    await estoqueService.definirMinimo(
      produtoId,
      variacaoId,
      valida.inteiro(estoqueMinimo, 'Estoque mínimo inválido', { min: 0, max: 1000000 })
    );
  }

  res.json({
    mensagem: 'Estoque atualizado com sucesso',
    variacao: await variacoesService.buscar(produtoId, variacaoId)
  });
});


/* =============================================================
   AVALIAÇÕES (moderação)
============================================================= */

router.get('/admin/avaliacoes', autenticarAdmin, async (req, res) => {
  res.json(await avaliacoesService.listarAdmin({
    pagina: req.query.pagina ? valida.inteiro(req.query.pagina, 'Página inválida', { min: 1 }) : 1
  }));
});

router.patch('/admin/avaliacoes/:id', autenticarAdmin, async (req, res) => {
  await avaliacoesService.alterarVisibilidade(
    valida.id(req.params.id),
    valida.paraBoolean(valida.obrigatorio(req.body?.visivel, 'Informe se a avaliação fica visível'))
  );
  res.json({ mensagem: 'Avaliação atualizada' });
});


module.exports = router;
