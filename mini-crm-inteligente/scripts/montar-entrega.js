/*
 * Monta ENTREGA/ com a estrutura do desafio, pronta para copiar ao Google Drive.
 * Uso: npm run entrega -- --nome "Seu Nome Completo" [--capturas pasta] [--evidencias pasta]
 * Só copia arquivos reais. Itens que exigem captura ou vídeo recebem um aviso, nunca um arquivo falso.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const EXCLUIDOS = /(^|[\\/])(node_modules|ENTREGA)([\\/]|$)|\.env$|credencia|secret|\.zip$/i;

function lerArgumentos(argv) {
  const opcoes = { nome: 'NOME COMPLETO', capturas: null, evidencias: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--nome') opcoes.nome = argv[i + 1];
    if (argv[i] === '--capturas') opcoes.capturas = path.resolve(argv[i + 1]);
    if (argv[i] === '--evidencias') opcoes.evidencias = path.resolve(argv[i + 1]);
  }
  return opcoes;
}

function copiar(origem, destino) {
  const stat = fs.statSync(origem);
  if (stat.isDirectory()) {
    fs.mkdirSync(destino, { recursive: true });
    for (const nome of fs.readdirSync(origem)) copiar(path.join(origem, nome), path.join(destino, nome));
    return;
  }
  if (EXCLUIDOS.test(origem)) return;
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.copyFileSync(origem, destino);
}

function escreverAviso(destino, texto) {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, texto, 'utf8');
}

const AVISO_CAPTURA = `# Captura pendente

Este arquivo deve ser uma captura REAL da interface, obtida com o CRM e o n8n em execução.
Gere com: npm run capturar -- --salvar-dir "<pasta>"  (ou faça a captura manualmente).
Não substitua por imagem ilustrativa.
`;

const AVISO_EVIDENCIAS = `# Evidências

Coloque aqui somente registros reais:

- capturas de tela dos três testes obrigatórios no CRM (cartão com categoria, prioridade e modo);
- captura do painel "Executions" do n8n mostrando a execução do webhook;
- arquivo de texto com a saída de \`npm run testar:webhook\`.

Indique em cada arquivo se a execução foi de IA real (Gemini) ou de SIMULAÇÃO (regras no n8n).
`;

const README_VIDEO = `# Demonstração em vídeo

Arquivo esperado: \`demonstracao.mp4\` (gravado pelo candidato; não é gerado automaticamente).

Roteiro e tempos: ver \`ROTEIRO-VIDEO.md\` na pasta do código-fonte. Limite: 3 minutos.

Ordem sugerida de gravação:
1. Tela principal do CRM (0:00–0:30).
2. Cadastro de um interessado fictício e troca de status (0:30–1:00).
3. Botão "Analisar com IA" e retorno exibido na tela (1:00–2:00).
4. Painel de execuções do n8n com o workflow ativo (2:00–2:30).
5. Explicação rápida da tecnologia (2:30–3:00).

Use somente dados fictícios.
`;

function executar() {
  const opcoes = lerArgumentos(process.argv.slice(2));
  const nomePasta = `Desafio Sirius Advisory — ${opcoes.nome}`;
  const entrega = path.join(RAIZ, 'ENTREGA');
  const pasta = path.join(entrega, nomePasta);
  fs.rmSync(pasta, { recursive: true, force: true });

  const app = path.join(pasta, '01 — Aplicativo');
  const codigo = path.join(app, 'codigo-fonte');
  const automacao = path.join(pasta, '02 — Automação');
  const video = path.join(pasta, '03 — Demonstração');

  for (const item of ['server.js', 'package.json', 'package-lock.json', '.env.example', '.gitignore', 'src', 'public', 'scripts', 'tests', 'n8n/codigo', 'README.md', 'GUIA-PASSO-A-PASSO.md', 'ROTEIRO-VIDEO.md', 'CHECKLIST-ENTREGA.md']) {
    const origem = path.join(RAIZ, item);
    if (fs.existsSync(origem)) copiar(origem, path.join(codigo, item));
  }
  copiar(path.join(RAIZ, 'n8n/codigo'), path.join(codigo, 'n8n/codigo'));
  copiar(path.join(RAIZ, 'n8n/workflow-n8n-ia.json'), path.join(codigo, 'n8n/workflow-n8n-ia.json'));
  copiar(path.join(RAIZ, 'n8n/workflow-n8n-simulacao.json'), path.join(codigo, 'n8n/workflow-n8n-simulacao.json'));

  fs.copyFileSync(path.join(RAIZ, 'README.md'), path.join(app, 'README.md'));

  copiar(path.join(RAIZ, 'n8n/workflow-n8n-ia.json'), path.join(automacao, 'workflow-n8n-ia.json'));
  copiar(path.join(RAIZ, 'n8n/workflow-n8n-simulacao.json'), path.join(automacao, 'workflow-n8n-simulacao.json'));

  const evidencias = path.join(automacao, 'evidencias');
  if (opcoes.evidencias) copiar(opcoes.evidencias, evidencias);
  if (!fs.existsSync(path.join(evidencias, 'README.md'))) escreverAviso(path.join(evidencias, 'README.md'), AVISO_EVIDENCIAS);

  if (opcoes.capturas && fs.existsSync(path.join(opcoes.capturas, 'captura-interface.png'))) {
    copiar(path.join(opcoes.capturas, 'captura-interface.png'), path.join(app, 'captura-interface.png'));
  } else {
    escreverAviso(path.join(app, 'captura-interface.PENDENTE.md'), AVISO_CAPTURA);
  }

  escreverAviso(path.join(video, 'README-VIDEO.md'), README_VIDEO);

  const zip = path.join(entrega, `${nomePasta}.zip`);
  fs.rmSync(zip, { force: true });
  const resultadoZip = spawnSync('zip', ['-rq', zip, nomePasta], { cwd: entrega });
  const status = resultadoZip.error || resultadoZip.status !== 0 ? 'zip não criado (comando zip ausente): compacte a pasta manualmente' : zip;

  console.log(`Pasta de entrega: ${pasta}`);
  console.log(`Zip: ${status}`);
}

executar();
