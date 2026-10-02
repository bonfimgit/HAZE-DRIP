/*
  Logs estruturados em JSON (uma linha por evento).
  O Railway exibe e permite filtrar esses logs.
*/

const config = require('../config/ambiente');

function escrever(nivel, mensagem, dados = {}) {

  if (config.emTeste && nivel !== 'error') {
    return;
  }

  const linha = JSON.stringify({
    nivel,
    mensagem,
    momento: new Date().toISOString(),
    ...dados
  });

  if (nivel === 'error') {
    console.error(linha);
  } else {
    console.log(linha);
  }
}

module.exports = {
  info: (mensagem, dados) => escrever('info', mensagem, dados),
  aviso: (mensagem, dados) => escrever('warn', mensagem, dados),
  erro: (mensagem, dados) => escrever('error', mensagem, dados)
};
