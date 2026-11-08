/*
  Integração com o Melhor Envio: cotação de frete (Correios PAC e
  SEDEX e outras transportadoras), sem contrato com os Correios.

  Conta gratuita; a cotação não tem custo. O valor cotado é o da
  etiqueta comprada pelo Melhor Envio (normalmente mais barato que o
  balcão da agência). Se a loja postar pagando no balcão, use
  FRETE_ADICIONAL para cobrir a diferença.

  Variáveis:
    MELHOR_ENVIO_TOKEN       token gerado no painel do Melhor Envio
    MELHOR_ENVIO_CEP_ORIGEM  CEP de onde os pacotes saem
                             (usa CORREIOS_CEP_ORIGEM se vazio)
    MELHOR_ENVIO_AMBIENTE    "producao" (padrão) ou "sandbox"
                             (o token precisa ser do mesmo ambiente)
    MELHOR_ENVIO_SERVICOS    IDs dos serviços (padrão "1,2" = PAC, SEDEX)
    MELHOR_ENVIO_CONTATO     e-mail técnico enviado no User-Agent (opcional)
    MELHOR_ENVIO_API_URL     só para testes com simulador local

  Formato da API conferido no SDK oficial (melhorenvio/shipment-sdk-php)
  e no plugin oficial para WooCommerce (melhorenvio/wp-melhorenvio-v2).
*/

const URLS = {
  producao: 'https://melhorenvio.com.br',
  sandbox: 'https://sandbox.melhorenvio.com.br'
};


/*
  Tolera os erros comuns ao colar o token no Render: "Bearer " na
  frente, aspas em volta e quebras de linha no meio (o token é longo).
*/
function token() {
  return String(process.env.MELHOR_ENVIO_TOKEN || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^Bearer\s+/i, '')
    .replace(/\s+/g, '');
}

function ambiente() {
  return (process.env.MELHOR_ENVIO_AMBIENTE || 'producao').toLowerCase() === 'sandbox' ? 'sandbox' : 'producao';
}

function cepOrigem() {
  return String(process.env.MELHOR_ENVIO_CEP_ORIGEM || process.env.CORREIOS_CEP_ORIGEM || '').replace(/\D/g, '');
}

function base() {

  if (process.env.MELHOR_ENVIO_API_URL) {
    return process.env.MELHOR_ENVIO_API_URL.replace(/\/+$/, '');
  }

  return URLS[ambiente()];
}

function servicos() {
  return String(process.env.MELHOR_ENVIO_SERVICOS || '1,2')
    .split(',')
    .map(item => item.trim())
    .filter(item => /^\d+$/.test(item))
    .join(',') || '1,2';
}

function configurado() {
  return Boolean(token() && cepOrigem().length === 8);
}

function userAgent() {
  const contato = (process.env.MELHOR_ENVIO_CONTATO || '').trim();
  return contato ? `Haze Drip (${contato})` : 'Haze Drip';
}

// "PAC", "SEDEX" dos Correios; nas demais aparece a transportadora
function nomeDoServico(servico) {
  return String(servico.name || 'Entrega').trim();
}


const melhorEnvio = {

  configurado,

  /*
    Cota um pacote. Devolve [{ codigo, nome, transportadora, valor,
    prazo_dias }] só com os serviços disponíveis para o CEP; lança erro
    se nenhum estiver disponível ou a API falhar.
  */
  async cotar({ cepDestino, pesoGramas, comprimentoCm, larguraCm, alturaCm, valorSeguro = 0 }) {

    const corpo = {
      from: { postal_code: cepOrigem() },
      to: { postal_code: cepDestino },
      volumes: [{
        height: alturaCm,
        width: larguraCm,
        length: comprimentoCm,
        // O Melhor Envio trabalha em quilos
        weight: Math.max(0.01, Number((pesoGramas / 1000).toFixed(3))),
        insurance: Math.max(0, Number(Number(valorSeguro || 0).toFixed(2)))
      }],
      services: servicos()
    };

    const resposta = await fetch(`${base()}/api/v2/me/shipment/calculate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token()}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': userAgent()
      },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(10000)
    });

    const texto = await resposta.text();

    let dados;

    try {
      dados = JSON.parse(texto);
    } catch {
      dados = { message: texto };
    }

    if (!resposta.ok) {

      const detalhe = dados.message || dados.error || JSON.stringify(dados.errors || '');

      /*
        Token recusado: diz qual ambiente foi usado e o tamanho do
        token (ajuda a ver token cortado ou de outro ambiente) sem
        mostrar o token no log.
      */
      const dica = resposta.status === 401
        ? ` (ambiente: ${ambiente()}; token com ${token().length} caracteres. ` +
          'Confira se o token é do mesmo ambiente — conta normal = producao, ' +
          'sandbox.melhorenvio.com.br = MELHOR_ENVIO_AMBIENTE=sandbox —, ' +
          'se não expirou e se tem a permissão de cotação de frete)'
        : '';

      const erro = new Error(`Melhor Envio respondeu ${resposta.status}: ${String(detalhe).slice(0, 200)}${dica}`);
      erro.statusMelhorEnvio = resposta.status;
      throw erro;
    }

    // Um único serviço pode vir como objeto em vez de lista
    const lista = Array.isArray(dados) ? dados : [dados];

    const opcoes = lista
      .filter(servico => servico && !servico.error)
      .map(servico => ({
        codigo: `me-${servico.id}`,
        nome: nomeDoServico(servico),
        transportadora: servico.company?.name || 'Melhor Envio',
        // custom_*: valores com os ajustes configurados na conta
        valor: Number(servico.custom_price ?? servico.price),
        prazo_dias: Number.isFinite(Number(servico.custom_delivery_time ?? servico.delivery_time))
          ? Number(servico.custom_delivery_time ?? servico.delivery_time)
          : null
      }))
      .filter(opcao => Number.isFinite(opcao.valor) && opcao.valor > 0);

    if (opcoes.length === 0) {
      const motivos = lista.map(servico => servico?.error).filter(Boolean).join('; ');
      throw new Error(`Melhor Envio: nenhum serviço disponível para o CEP ${cepDestino}${motivos ? ` (${motivos.slice(0, 200)})` : ''}`);
    }

    return opcoes;
  }
};

module.exports = melhorEnvio;
