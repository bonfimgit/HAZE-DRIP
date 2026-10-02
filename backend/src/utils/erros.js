/*
  Erro com status HTTP. Qualquer ErroApp lançado em uma rota
  ou serviço é convertido em resposta JSON pelo middleware
  de tratamento de erros.
*/

class ErroApp extends Error {

  constructor(status, mensagem, detalhes) {
    super(mensagem);
    this.name = 'ErroApp';
    this.status = status;
    this.detalhes = detalhes;
  }
}

const erros = {
  requisicaoInvalida: (mensagem, detalhes) => new ErroApp(400, mensagem, detalhes),
  naoAutorizado: mensagem => new ErroApp(401, mensagem),
  proibido: mensagem => new ErroApp(403, mensagem),
  naoEncontrado: mensagem => new ErroApp(404, mensagem),
  conflito: mensagem => new ErroApp(409, mensagem),
  muitasRequisicoes: mensagem => new ErroApp(429, mensagem),
  indisponivel: mensagem => new ErroApp(503, mensagem)
};

module.exports = { ErroApp, ...erros };
