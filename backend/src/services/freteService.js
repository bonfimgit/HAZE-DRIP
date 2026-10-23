/*
  Frete pelos Correios (quando configurado) ou por tabela própria.

  Correios: com as variáveis CORREIOS_* preenchidas, o valor e o prazo
  vêm da API dos Correios (PAC, SEDEX...) para o CEP do cliente. O
  pacote é estimado assim:
    FRETE_PESO_ITEM_GRAMAS   peso de cada peça já embalada (padrão 300)
    FRETE_EMBALAGEM_CM       caixa "comprimento x largura x altura" (padrão 30x20x10)
    FRETE_ADICIONAL          valor somado a cada cotação, ex.: embalagem (padrão 0)
    FRETE_DIAS_POSTAGEM      dias úteis até postar, somados ao prazo (padrão 1)
  A tabela continua valendo para o frete grátis ("gratis_acima" da
  regra do CEP) e como reserva se os Correios não responderem.
  O frete grátis vale para a opção mais barata.

  Tabela própria:

  Cada regra vale para:
    - uma faixa de CEP (cep_inicio..cep_fim), ou
    - um estado (uf), ou
    - todo o Brasil (sem uf e sem faixa) — regra padrão.
  A regra mais específica vence: faixa de CEP > estado > padrão.
  "gratis_acima" zera o frete quando o valor dos produtos
  (já com desconto) atinge o mínimo.
*/

const db = require('../config/db');
const { naoEncontrado, requisicaoInvalida } = require('../utils/erros');
const { arredondar } = require('../utils/dinheiro');
const logger = require('../utils/logger');
const correios = require('../integracoes/correios');


function especificidade(regra) {
  if (regra.cep_inicio) return 3;
  if (regra.uf) return 2;
  return 1;
}


async function buscarRegra(cep, uf, conexao = db) {

  const cepNumeros = String(cep || '').replace(/\D/g, '');

  if (cepNumeros.length !== 8) {
    throw requisicaoInvalida('CEP inválido');
  }

  const [regras] = await conexao.query(
    `SELECT *
     FROM frete_regras
     WHERE ativo = TRUE
     AND (
       (cep_inicio IS NOT NULL AND ? BETWEEN cep_inicio AND cep_fim)
       OR (cep_inicio IS NULL AND uf = ?)
       OR (cep_inicio IS NULL AND uf IS NULL)
     )`,
    [cepNumeros, (uf || '').toUpperCase()]
  );

  if (regras.length === 0) {
    return null;
  }

  // Mais específica primeiro; empate: menor valor
  regras.sort((a, b) =>
    especificidade(b) - especificidade(a) || Number(a.valor) - Number(b.valor)
  );

  return regras[0];
}


/* =============================================================
   CORREIOS
============================================================= */

const CACHE_MS = 30 * 60 * 1000;
const CACHE_MAX = 500;
const cacheCorreios = new Map();   // "cep|peso" -> { expira, opcoes }


function numeroAmbiente(nome, padrao) {
  const valor = Number(String(process.env[nome] ?? '').replace(',', '.'));
  return process.env[nome] && Number.isFinite(valor) && valor >= 0 ? valor : padrao;
}


function pacote(quantidadeItens) {

  const [comprimento, largura, altura] = String(process.env.FRETE_EMBALAGEM_CM || '30x20x10')
    .toLowerCase()
    .split('x')
    .map(Number);

  const quantidade = Math.max(1, Math.min(Number(quantidadeItens) || 1, 100));

  return {
    pesoGramas: quantidade * numeroAmbiente('FRETE_PESO_ITEM_GRAMAS', 300),
    // Mínimos aceitos pelos Correios: 15 x 10 x 1 cm
    comprimentoCm: Math.max(15, comprimento || 30),
    larguraCm: Math.max(10, largura || 20),
    alturaCm: Math.max(1, altura || 10)
  };
}


/*
  Opções dos Correios para o CEP, já com adicional e dias de postagem.
  Devolve null quando os Correios não estão configurados ou falharam
  (o frete cai na tabela).
*/
async function cotarCorreios({ cep, quantidadeItens }) {

  if (!correios.configurado()) {
    return null;
  }

  const cepDestino = String(cep || '').replace(/\D/g, '');

  if (cepDestino.length !== 8) {
    return null;
  }

  const dadosPacote = pacote(quantidadeItens);
  const chave = `${cepDestino}|${dadosPacote.pesoGramas}`;
  const emCache = cacheCorreios.get(chave);

  if (emCache && emCache.expira > Date.now()) {
    return emCache.opcoes;
  }

  try {

    const adicional = numeroAmbiente('FRETE_ADICIONAL', 0);
    const diasPostagem = numeroAmbiente('FRETE_DIAS_POSTAGEM', 1);

    const opcoes = (await correios.cotar({ cepDestino, ...dadosPacote }))
      .map(opcao => ({
        codigo: opcao.codigo,
        nome: opcao.nome,
        valor: arredondar(opcao.valor + adicional),
        prazo_dias: opcao.prazo_dias == null ? null : opcao.prazo_dias + diasPostagem
      }))
      .sort((a, b) => a.valor - b.valor);

    if (cacheCorreios.size >= CACHE_MAX) {
      cacheCorreios.delete(cacheCorreios.keys().next().value);
    }

    cacheCorreios.set(chave, { expira: Date.now() + CACHE_MS, opcoes });

    return opcoes;

  } catch (erro) {
    logger.aviso('Cotação dos Correios falhou; usando a tabela de frete', { erro: erro.message });
    return null;
  }
}


function limparCacheCorreios() {
  cacheCorreios.clear();
}


/*
  Calcula o frete de um pedido.
  "servico" escolhe a opção dos Correios (código); sem ele, a mais barata.
  "opcoesCorreios" permite reaproveitar uma cotação já feita (o checkout
  cota antes da transação para não segurar o banco esperando a API).
  Lança erro se nem os Correios nem a tabela atenderem o CEP.
*/
async function calcular({
  cep,
  uf,
  valorProdutos,
  freteGratisCupom = false,
  quantidadeItens = 1,
  servico = null,
  opcoesCorreios,
  conexao = db
}) {

  const regra = await buscarRegra(cep, uf, conexao);

  const gratisAcima = regra && regra.gratis_acima != null ? Number(regra.gratis_acima) : null;

  const gratis =
    freteGratisCupom ||
    (gratisAcima != null && Number(valorProdutos) >= gratisAcima);

  const opcoes = opcoesCorreios !== undefined
    ? opcoesCorreios
    : await cotarCorreios({ cep, quantidadeItens });

  if (opcoes && opcoes.length > 0) {

    // Frete grátis só na opção mais barata (a primeira)
    const lista = opcoes.map((opcao, indice) => ({
      ...opcao,
      valor_original: opcao.valor,
      valor: gratis && indice === 0 ? 0 : opcao.valor,
      gratis: gratis && indice === 0
    }));

    const escolhida = lista.find(opcao => opcao.codigo === servico) || lista[0];

    return {
      regra_id: regra ? regra.id : null,
      origem: 'correios',
      servico: escolhida.codigo,
      descricao: `Correios ${escolhida.nome}`,
      valor: escolhida.valor,
      valor_original: escolhida.valor_original,
      gratis: escolhida.gratis,
      gratis_acima: gratisAcima,
      prazo_min_dias: escolhida.prazo_dias,
      prazo_max_dias: escolhida.prazo_dias,
      opcoes: lista
    };
  }

  if (!regra) {
    throw requisicaoInvalida('Ainda não entregamos para este CEP');
  }

  return {
    regra_id: regra.id,
    origem: 'tabela',
    servico: null,
    descricao: regra.nome,
    valor: gratis ? 0 : arredondar(regra.valor),
    valor_original: arredondar(regra.valor),
    gratis,
    gratis_acima: gratisAcima,
    prazo_min_dias: regra.prazo_min_dias,
    prazo_max_dias: regra.prazo_max_dias,
    opcoes: []
  };
}


/* =============================================================
   ADMIN
============================================================= */

async function listar() {
  const [regras] = await db.query(
    'SELECT * FROM frete_regras ORDER BY ativo DESC, uf IS NULL, uf, cep_inicio, id'
  );
  return regras;
}


async function buscar(id) {
  const [regras] = await db.execute('SELECT * FROM frete_regras WHERE id = ?', [id]);
  if (regras.length === 0) {
    throw naoEncontrado('Regra de frete não encontrada');
  }
  return regras[0];
}


async function salvar(id, dados) {

  const valores = [
    dados.nome,
    dados.uf,
    dados.cepInicio,
    dados.cepFim,
    dados.valor,
    dados.prazoMin,
    dados.prazoMax,
    dados.gratisAcima,
    dados.ativo
  ];

  if (id) {

    await buscar(id);

    await db.execute(
      `UPDATE frete_regras
       SET nome = ?, uf = ?, cep_inicio = ?, cep_fim = ?, valor = ?,
           prazo_min_dias = ?, prazo_max_dias = ?, gratis_acima = ?, ativo = ?
       WHERE id = ?`,
      [...valores, id]
    );

    return buscar(id);
  }

  const [resultado] = await db.execute(
    `INSERT INTO frete_regras
      (nome, uf, cep_inicio, cep_fim, valor, prazo_min_dias, prazo_max_dias, gratis_acima, ativo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    valores
  );

  return buscar(resultado.insertId);
}


async function remover(id) {
  const [resultado] = await db.execute('DELETE FROM frete_regras WHERE id = ?', [id]);
  if (resultado.affectedRows === 0) {
    throw naoEncontrado('Regra de frete não encontrada');
  }
}


module.exports = {
  buscarRegra,
  calcular,
  cotarCorreios,
  limparCacheCorreios,
  listar,
  buscar,
  salvar,
  remover
};
