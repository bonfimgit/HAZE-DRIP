/*
  Limitador de requisições em memória.

  Suficiente para uma única instância da API (cenário atual no
  Railway). Com várias instâncias, trocar por um armazenamento
  compartilhado (ex.: Redis).
*/

const { muitasRequisicoes } = require('../utils/erros');

function criarLimitador({
  maximo,
  janelaMs,
  mensagem = 'Muitas requisições. Tente novamente mais tarde.',
  chave = req => req.ip
}) {

  const registros = new Map();

  // Limpeza periódica para não acumular chaves antigas
  const limpeza = setInterval(() => {
    const agora = Date.now();
    for (const [k, registro] of registros) {
      if (agora - registro.inicio > janelaMs) {
        registros.delete(k);
      }
    }
  }, janelaMs);

  limpeza.unref();

  function obter(k) {

    const registro = registros.get(k);

    if (!registro || Date.now() - registro.inicio > janelaMs) {
      const novo = { quantidade: 0, inicio: Date.now() };
      registros.set(k, novo);
      return novo;
    }

    return registro;
  }

  return {

    // Middleware: conta toda requisição
    middleware(req, res, next) {

      const registro = obter(chave(req));

      registro.quantidade++;

      if (registro.quantidade > maximo) {
        throw muitasRequisicoes(mensagem);
      }

      next();
    },

    // Uso manual: conta só falhas (ex.: senha errada)
    bloqueado(k) {
      return obter(k).quantidade >= maximo;
    },

    registrarFalha(k) {
      obter(k).quantidade++;
    },

    limpar(k) {
      registros.delete(k);
    },

    limparTudo() {
      registros.clear();
    }
  };
}

module.exports = { criarLimitador };
