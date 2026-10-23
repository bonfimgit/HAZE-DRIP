/*
  Cliente da API dos Correios (https://www.correios.com.br/atendimento/developers).
  Exige contrato com os Correios e o serviço "API Preços" (e "API Prazo")
  liberado no cartão de postagem.

  Variáveis:
    CORREIOS_USUARIO           usuário do Meu Correios (ou CNPJ)
    CORREIOS_CODIGO_ACESSO     código de acesso às APIs (gerado no portal CWS)
    CORREIOS_CARTAO_POSTAGEM   número do cartão de postagem
    CORREIOS_CEP_ORIGEM        CEP de onde os pacotes saem
    CORREIOS_CONTRATO          número do contrato (opcional, preço de contrato)
    CORREIOS_DR                código da diretoria regional (opcional, junto do contrato)
    CORREIOS_SERVICOS          serviços cotados, "codigo:nome" separados por vírgula
                               (padrão: 03298:PAC,03220:SEDEX — códigos de contrato)
    CORREIOS_API_URL           padrão https://api.correios.com.br
                               (homologação: https://apihom.correios.com.br)

  As funções ficam num objeto exportado para que os testes possam
  substituí-las sem chamar a API real.
*/

const SERVICOS_PADRAO = '03298:PAC,03220:SEDEX';

let tokenAtual = null;     // { valor, expiraEm (ms) }
let tokenPendente = null;  // pedido de token em andamento (consultas paralelas esperam o mesmo)


function base() {
  return (process.env.CORREIOS_API_URL || 'https://api.correios.com.br').replace(/\/+$/, '');
}


function configurado() {
  return Boolean(
    process.env.CORREIOS_USUARIO &&
    process.env.CORREIOS_CODIGO_ACESSO &&
    process.env.CORREIOS_CARTAO_POSTAGEM &&
    process.env.CORREIOS_CEP_ORIGEM
  );
}


function servicos() {
  return (process.env.CORREIOS_SERVICOS || SERVICOS_PADRAO)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const [codigo, ...nome] = item.split(':');
      return { codigo: codigo.trim(), nome: nome.join(':').trim() || codigo.trim() };
    });
}


async function lerResposta(resposta, contexto) {

  const texto = await resposta.text();

  let dados = null;

  try {
    dados = JSON.parse(texto);
  } catch {
    dados = { msgs: [texto] };
  }

  if (!resposta.ok) {
    const detalhe = Array.isArray(dados.msgs) ? dados.msgs.join(' ') : (dados.message || '');
    const erro = new Error(`Correios (${contexto}) respondeu ${resposta.status}: ${detalhe.slice(0, 200)}`);
    erro.statusCorreios = resposta.status;
    throw erro;
  }

  return dados;
}


/*
  Token do cartão de postagem. Vale algumas horas; é reaproveitado
  até 5 minutos antes de expirar.
*/
async function obterToken() {

  if (tokenAtual && tokenAtual.expiraEm > Date.now()) {
    return tokenAtual.valor;
  }

  if (!tokenPendente) {
    tokenPendente = gerarToken().finally(() => {
      tokenPendente = null;
    });
  }

  return tokenPendente;
}


async function gerarToken() {

  const credenciais = Buffer
    .from(`${process.env.CORREIOS_USUARIO}:${process.env.CORREIOS_CODIGO_ACESSO}`)
    .toString('base64');

  const resposta = await fetch(`${base()}/token/v1/autentica/cartaopostagem`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credenciais}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ numero: process.env.CORREIOS_CARTAO_POSTAGEM }),
    signal: AbortSignal.timeout(10000)
  });

  const dados = await lerResposta(resposta, 'token');

  const expira = Date.parse(dados.expiraEm);

  tokenAtual = {
    valor: dados.token,
    expiraEm: (Number.isNaN(expira) ? Date.now() + 60 * 60 * 1000 : expira) - 5 * 60 * 1000
  };

  return tokenAtual.valor;
}


async function consultar(caminho, parametros, contexto) {

  const token = await obterToken();

  const resposta = await fetch(`${base()}${caminho}?${new URLSearchParams(parametros)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000)
  });

  // Token revogado antes da hora: descarta para renovar na próxima
  if (resposta.status === 401 || resposta.status === 403) {
    tokenAtual = null;
  }

  return lerResposta(resposta, contexto);
}


// "1.234,56" -> 1234.56
function lerValor(valor) {
  if (typeof valor === 'number') return valor;
  const numero = Number(String(valor || '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(numero) ? numero : null;
}


// dd-MM-yyyy, como a API espera
function hoje() {
  const [ano, mes, dia] = new Date().toLocaleDateString('sv-SE').split('-');
  return `${dia}-${mes}-${ano}`;
}


const correios = {

  configurado,

  servicos,

  /*
    Cota todos os serviços configurados para um pacote.
    Devolve [{ codigo, nome, valor, prazo_dias }] só com os serviços
    que responderam; lança erro se nenhum respondeu.
  */
  async cotar({ cepDestino, pesoGramas, comprimentoCm, larguraCm, alturaCm }) {

    const cepOrigem = String(process.env.CORREIOS_CEP_ORIGEM).replace(/\D/g, '');
    const dtEvento = hoje();

    const resultados = await Promise.allSettled(servicos().map(async servico => {

      const parametrosPreco = {
        cepOrigem,
        cepDestino,
        psObjeto: String(Math.ceil(pesoGramas)),
        tpObjeto: '2',
        comprimento: String(comprimentoCm),
        largura: String(larguraCm),
        altura: String(alturaCm),
        dtEvento
      };

      if (process.env.CORREIOS_CONTRATO) parametrosPreco.nuContrato = process.env.CORREIOS_CONTRATO;
      if (process.env.CORREIOS_DR) parametrosPreco.nuDR = process.env.CORREIOS_DR;

      const [preco, prazo] = await Promise.allSettled([
        consultar(`/preco/v1/nacional/${servico.codigo}`, parametrosPreco, `preço ${servico.nome}`),
        consultar(`/prazo/v1/nacional/${servico.codigo}`, { cepOrigem, cepDestino, dtEvento }, `prazo ${servico.nome}`)
      ]);

      if (preco.status === 'rejected') {
        throw preco.reason;
      }

      const valor = lerValor(preco.value.pcFinal);

      if (valor == null) {
        throw new Error(`Correios (preço ${servico.nome}) sem valor na resposta`);
      }

      const prazoDias = prazo.status === 'fulfilled' ? Number(prazo.value.prazoEntrega) : NaN;

      return {
        codigo: servico.codigo,
        nome: servico.nome,
        valor,
        prazo_dias: Number.isFinite(prazoDias) ? prazoDias : null
      };
    }));

    const opcoes = resultados
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);

    if (opcoes.length === 0) {
      const motivos = resultados.map(r => r.reason?.message).filter(Boolean).join(' | ');
      throw new Error(motivos || 'Correios sem serviços configurados');
    }

    return opcoes;
  },

  // Usado pelos testes
  limparToken() {
    tokenAtual = null;
  }
};


module.exports = correios;
