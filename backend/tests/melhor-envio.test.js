/*
  Frete pelo Melhor Envio, contra um simulador local da API
  (POST /api/v2/me/shipment/calculate), que guarda o que a loja enviou.
*/

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');

const { prepararAmbiente, finalizarAmbiente, db } = require('./ajuda');
const freteService = require('../src/services/freteService');

let api;
let ids;
let token;

let servidor;
let recebidas = [];
let responder;

const VARIAVEIS = {
  MELHOR_ENVIO_TOKEN: 'token-de-teste',
  MELHOR_ENVIO_CEP_ORIGEM: '37900-000',
  MELHOR_ENVIO_CONTATO: 'contato@loja.test'
};

// Resposta no formato da API: um item por serviço pedido
function respostaPadrao() {
  return [
    {
      id: 1, name: 'PAC', price: '22.50', custom_price: '21.90',
      delivery_time: 6, custom_delivery_time: 7,
      company: { id: 1, name: 'Correios' }
    },
    {
      id: 2, name: 'SEDEX', price: '38.70', custom_price: '38.70',
      delivery_time: 2, custom_delivery_time: 2,
      company: { id: 1, name: 'Correios' }
    },
    { id: 17, name: 'Mini Envios', error: 'Serviço indisponível para o trecho.', company: { id: 1, name: 'Correios' } }
  ];
}


before(async () => {

  servidor = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', parte => { corpo += parte; });
    req.on('end', () => {
      recebidas.push({ metodo: req.method, url: req.url, cabecalhos: req.headers, corpo: JSON.parse(corpo || '{}') });
      const { status, dados } = responder();
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(dados));
    });
  });

  await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
  process.env.MELHOR_ENVIO_API_URL = `http://127.0.0.1:${servidor.address().port}`;

  ({ api, ids, tokenAdmin: token } = await prepararAmbiente());
});

after(async () => {
  for (const nome of [...Object.keys(VARIAVEIS), 'MELHOR_ENVIO_API_URL']) delete process.env[nome];
  await new Promise(resolve => servidor.close(resolve));
  await finalizarAmbiente(api);
});

beforeEach(() => {
  Object.assign(process.env, VARIAVEIS);
  recebidas = [];
  responder = () => ({ status: 200, dados: respostaPadrao() });
  freteService.limparCacheCorreios();
});


test('cotação pelo Melhor Envio: PAC e SEDEX com valor e prazo da conta', async () => {

  const cotacao = await api.post('/checkout/cotacao', {
    itens: [{ variacao_id: ids.variacaoPId, quantidade: 2 }],
    cep: '01310-100'
  });

  assert.equal(cotacao.status, 200);

  const frete = cotacao.dados.frete;
  assert.equal(frete.origem, 'melhorenvio');
  assert.equal(frete.descricao, 'Correios PAC');
  assert.equal(frete.servico, 'me-1');

  // custom_price e custom_delivery_time + 1 dia de postagem (padrão)
  assert.deepEqual(frete.opcoes.map(o => [o.codigo, o.transportadora, o.nome, o.valor, o.prazo_dias]), [
    ['me-1', 'Correios', 'PAC', 21.9, 8],
    ['me-2', 'Correios', 'SEDEX', 38.7, 3]
  ]);
  assert.equal(cotacao.dados.total, 200 + 21.9);

  // O que a loja mandou para o Melhor Envio
  assert.equal(recebidas.length, 1);
  const [req] = recebidas;
  assert.equal(req.metodo, 'POST');
  assert.equal(req.url, '/api/v2/me/shipment/calculate');
  assert.equal(req.cabecalhos.authorization, 'Bearer token-de-teste');
  assert.equal(req.cabecalhos.accept, 'application/json');
  assert.equal(req.cabecalhos['user-agent'], 'Haze Drip (contato@loja.test)');
  assert.deepEqual(req.corpo.from, { postal_code: '37900000' });
  assert.deepEqual(req.corpo.to, { postal_code: '01310100' });
  assert.equal(req.corpo.services, '1,2');
  assert.deepEqual(req.corpo.volumes, [{ height: 10, width: 20, length: 30, weight: 0.6, insurance: 200 }]);
});

test('escolher SEDEX muda o valor; frete grátis vale só para a opção mais barata', async () => {

  let cotacao = await api.post('/checkout/cotacao', {
    itens: [{ variacao_id: ids.variacaoPId, quantidade: 1 }],
    cep: '01310-100',
    servico_frete: 'me-2'
  });
  assert.equal(cotacao.dados.frete.descricao, 'Correios SEDEX');
  assert.equal(cotacao.dados.frete.valor, 38.7);

  // R$ 500 em produtos (acima de R$ 399 da regra padrão): PAC grátis, SEDEX pago
  cotacao = await api.post('/checkout/cotacao', {
    itens: [{ variacao_id: ids.variacaoPId, quantidade: 5 }],
    cep: '01310-100'
  });
  const [pac, sedex] = cotacao.dados.frete.opcoes;
  assert.equal(pac.gratis, true);
  assert.equal(pac.valor, 0);
  assert.equal(sedex.gratis, false);
  assert.equal(sedex.valor, 38.7);
  assert.equal(cotacao.dados.total, 500);
});

test('pedido cobra o frete cotado e usa o mesmo valor segurado', async () => {

  const resposta = await api.post('/checkout', {
    cliente: { nome: 'Ana Compradora', email: 'ana-me@teste.com', telefone: '35999998888' },
    endereco: { cep: '01310-100', rua: 'Av. Paulista', numero: '1000', bairro: 'Bela Vista', cidade: 'São Paulo', estado: 'SP' },
    itens: [{ produto_id: ids.produtoId, variacao_id: ids.variacaoPId, quantidade: 1 }],
    metodo_pagamento: 'infinitepay',
    servico_frete: 'me-2',
    chave_idempotencia: crypto.randomUUID()
  });

  assert.equal(resposta.status, 201, JSON.stringify(resposta.dados));

  const [[pedido]] = await db.query(
    'SELECT frete, total, frete_descricao, frete_prazo_max FROM pedidos WHERE id = ?',
    [resposta.dados.pedido.id]
  );
  assert.equal(Number(pedido.frete), 38.7);
  assert.equal(Number(pedido.total), 138.7);
  assert.equal(pedido.frete_descricao, 'Correios SEDEX');
  assert.equal(pedido.frete_prazo_max, 3);

  assert.equal(recebidas.at(-1).corpo.volumes[0].insurance, 100);
});

test('Melhor Envio fora do ar ou token inválido: frete cai na tabela do painel', async () => {

  responder = () => ({ status: 401, dados: { message: 'Unauthenticated.' } });

  const cotacao = await api.post('/checkout/cotacao', {
    itens: [{ variacao_id: ids.variacaoPId, quantidade: 1 }],
    cep: '01310-100'
  });

  assert.equal(cotacao.status, 200);
  assert.equal(cotacao.dados.frete.origem, 'tabela');
  assert.equal(cotacao.dados.frete.descricao, 'Entrega padrão');
});

test('nenhum serviço disponível para o CEP: frete cai na tabela', async () => {

  responder = () => ({ status: 200, dados: [{ id: 1, name: 'PAC', error: 'CEP de destino inválido', company: { name: 'Correios' } }] });

  const cotacao = await api.post('/checkout/cotacao', {
    itens: [{ variacao_id: ids.variacaoPId, quantidade: 1 }],
    cep: '01310-100'
  });

  assert.equal(cotacao.dados.frete.origem, 'tabela');
});

test('sem token ou sem CEP de origem: não chama o Melhor Envio', async () => {

  delete process.env.MELHOR_ENVIO_TOKEN;

  let cotacao = await api.post('/checkout/cotacao', { itens: [{ variacao_id: ids.variacaoPId, quantidade: 1 }], cep: '01310-100' });
  assert.equal(cotacao.dados.frete.origem, 'tabela');

  process.env.MELHOR_ENVIO_TOKEN = 'token-de-teste';
  delete process.env.MELHOR_ENVIO_CEP_ORIGEM;

  cotacao = await api.post('/checkout/cotacao', { itens: [{ variacao_id: ids.variacaoPId, quantidade: 1 }], cep: '01310-100' });
  assert.equal(cotacao.dados.frete.origem, 'tabela');

  assert.equal(recebidas.length, 0);
});

test('cotação repetida usa o cache (não chama a API de novo)', async () => {

  const corpo = { itens: [{ variacao_id: ids.variacaoPId, quantidade: 1 }], cep: '01310-100' };

  await api.post('/checkout/cotacao', corpo);
  await api.post('/checkout/cotacao', corpo);

  assert.equal(recebidas.length, 1);
});

test('painel: simular frete mostra a cotação do Melhor Envio', async () => {

  const simulacao = await api.get('/admin/frete/simular?cep=01310-100&valor=150', { token });

  assert.equal(simulacao.status, 200);
  assert.equal(simulacao.dados.origem, 'melhorenvio');
  assert.equal(simulacao.dados.opcoes.length, 2);
});


test('token colado com "Bearer", aspas ou quebra de linha é limpo antes do envio', async () => {

  process.env.MELHOR_ENVIO_TOKEN = '  "Bearer token-de-\nteste"\n';

  await api.post('/checkout/cotacao', { itens: [{ variacao_id: ids.variacaoPId, quantidade: 1 }], cep: '01310-100' });

  assert.equal(recebidas.at(-1).cabecalhos.authorization, 'Bearer token-de-teste');
});

test('token recusado (401): log explica ambiente e tamanho do token, sem mostrar o token', async () => {

  const logger = require('../src/utils/logger');
  const avisos = [];
  const avisoOriginal = logger.aviso;
  logger.aviso = (mensagem, dados) => avisos.push({ mensagem, dados });

  responder = () => ({ status: 401, dados: { message: 'Unauthenticated.' } });

  try {
    await api.post('/checkout/cotacao', { itens: [{ variacao_id: ids.variacaoPId, quantidade: 1 }], cep: '01310-100' });
  } finally {
    logger.aviso = avisoOriginal;
  }

  const registro = avisos.find(a => a.mensagem.startsWith('Cotação de frete falhou'));
  assert.ok(registro);
  assert.match(registro.dados.erro, /401: Unauthenticated\. \(ambiente: producao; token com 14 caracteres/);
  assert.doesNotMatch(registro.dados.erro, /token-de-teste/);
});
