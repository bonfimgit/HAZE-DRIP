/*
 * Teste ao vivo: envia os três cenários obrigatórios ao CRM em execução (que encaminha ao n8n).
 * Uso: npm run testar:webhook  [-- --url http://localhost:3000] [-- --salvar caminho/arquivo.txt]
 * Não usa mocks: se o n8n estiver offline, o script mostra o erro real.
 */
const fs = require('node:fs');

const CENARIOS = [
  {
    nome: 'Teste 1 — Dúvidas',
    mensagem: 'Quero abrir uma empresa no Paraguai, mas não sei se é melhor EAS ou Unipersonal. Ainda não tenho cédula.',
    esperado: 'Consultoria ou pergunta complementar; sem orientação jurídica definitiva',
  },
  {
    nome: 'Teste 2 — Pronto para contratar',
    mensagem: 'Já tenho cédula paraguaia e quero contratar o serviço de abertura de EAS.',
    esperado: 'Prioridade Alta, categoria Abertura de empresa',
  },
  {
    nome: 'Teste 3 — Pesquisando',
    mensagem: 'Ainda não quero abrir empresa. Gostaria de aprender mais sobre negócios no Paraguai.',
    esperado: 'Prioridade Baixa, categoria Produtos digitais',
  },
];

function lerArgumentos(argv) {
  const opcoes = { url: process.env.CRM_URL || 'http://localhost:3000', salvar: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--url') opcoes.url = argv[i + 1];
    if (argv[i] === '--salvar') opcoes.salvar = argv[i + 1];
  }
  return opcoes;
}

async function executar() {
  const opcoes = lerArgumentos(process.argv.slice(2));
  const linhas = [`Teste ao vivo em ${new Date().toISOString()} contra ${opcoes.url}/api/analisar`, ''];
  let falhas = 0;

  for (const cenario of CENARIOS) {
    const corpo = { nome: 'Bruno Ferreira', whatsapp: '+55 00 90000-0002', mensagem: cenario.mensagem };
    linhas.push(`## ${cenario.nome}`, `Mensagem: ${cenario.mensagem}`, `Esperado: ${cenario.esperado}`);
    try {
      const resposta = await fetch(`${opcoes.url}/api/analisar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(40000),
      });
      const dados = await resposta.json();
      if (!resposta.ok) {
        falhas += 1;
        linhas.push(`Resultado: HTTP ${resposta.status} — ${JSON.stringify(dados)}`);
      } else {
        linhas.push(`Resultado: HTTP ${resposta.status}`, `  categoria: ${dados.categoria}`, `  prioridade: ${dados.prioridade}`, `  modo: ${dados.modo}`, `  resposta: ${dados.resposta}`);
      }
    } catch (erro) {
      falhas += 1;
      linhas.push(`Resultado: falha de conexão — ${erro.message}. Confirme se "npm start" está rodando.`);
    }
    linhas.push('');
  }

  linhas.push(`Resumo: ${CENARIOS.length - falhas} de ${CENARIOS.length} chamadas responderam com sucesso.`);
  const texto = linhas.join('\n');
  console.log(texto);
  if (opcoes.salvar) fs.writeFileSync(opcoes.salvar, texto + '\n', 'utf8');
  process.exitCode = falhas ? 1 : 0;
}

executar();
