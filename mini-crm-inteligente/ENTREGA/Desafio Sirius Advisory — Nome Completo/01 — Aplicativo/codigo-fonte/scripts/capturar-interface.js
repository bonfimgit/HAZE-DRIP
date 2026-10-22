/*
 * Gera capturas REAIS da interface executando os três cenários pela própria tela.
 * Requer o CRM em execução (npm start) e o n8n com o workflow ativo.
 * Uso: npm run capturar -- --salvar-dir "pasta"  [--url http://localhost:3000]
 * Só grava o que a tela mostrar: nada é editado nem inventado. O modo aparece como veio do n8n.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const CAMINHO_CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const CENARIOS = [
  { nome: 'Carla Mendes', mensagem: 'Quero abrir uma empresa no Paraguai, mas não sei se é melhor EAS ou Unipersonal. Ainda não tenho cédula.' },
  { nome: 'Bruno Ferreira', mensagem: 'Já tenho cédula paraguaia e quero contratar o serviço de abertura de EAS.' },
  { nome: 'Diego Rocha', mensagem: 'Ainda não quero abrir empresa. Gostaria de aprender mais sobre negócios no Paraguai.' },
];

function lerArgumentos(argv) {
  const opcoes = { url: 'http://localhost:3000', pasta: path.join(process.cwd(), 'capturas') };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--url') opcoes.url = argv[i + 1];
    if (argv[i] === '--salvar-dir') opcoes.pasta = path.resolve(argv[i + 1]);
  }
  return opcoes;
}

async function executar() {
  const opcoes = lerArgumentos(process.argv.slice(2));
  fs.mkdirSync(opcoes.pasta, { recursive: true });
  const navegador = await chromium.launch({ executablePath: CAMINHO_CHROME, args: ['--no-sandbox'] });
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
  const pagina = await contexto.newPage();
  const resultados = [];

  try {
    await pagina.goto(opcoes.url);
    for (const cenario of CENARIOS) {
      await pagina.fill('#campo-nome', cenario.nome);
      await pagina.fill('#campo-whatsapp', '+55 00 90000-0002');
      await pagina.fill('#campo-mensagem', cenario.mensagem);
      await pagina.click('button[type="submit"]');
      await pagina.locator('.contato', { hasText: cenario.nome }).waitFor();

      const cartao = pagina.locator('.contato', { hasText: cenario.nome });
      await cartao.locator('[data-acao="analisar"]').click();
      await cartao.locator('.analise .chip.categoria').or(cartao.locator('[data-erro-analise]:not(:empty)')).waitFor({ timeout: 45000 });

      const erro = (await cartao.locator('[data-erro-analise]').textContent()).trim();
      if (erro) {
        resultados.push({ nome: cenario.nome, erro });
      } else {
        resultados.push({
          nome: cenario.nome,
          categoria: await cartao.locator('.analise .chip.categoria').textContent(),
          prioridade: await cartao.locator('.analise .chip.prioridade').textContent(),
          modo: await cartao.locator('.analise .chip.modo').textContent(),
        });
      }
    }

    await pagina.locator('.contato', { hasText: CENARIOS[2].nome }).locator('.status-select').selectOption('Em atendimento');
    await pagina.screenshot({ path: path.join(opcoes.pasta, 'captura-interface.png'), fullPage: true });
    await pagina.locator('.contato', { hasText: CENARIOS[0].nome }).screenshot({ path: path.join(opcoes.pasta, 'captura-cartao-teste1.png') });
    await pagina.locator('.contato', { hasText: CENARIOS[1].nome }).screenshot({ path: path.join(opcoes.pasta, 'captura-cartao-teste2.png') });
    await pagina.locator('.contato', { hasText: CENARIOS[2].nome }).screenshot({ path: path.join(opcoes.pasta, 'captura-cartao-teste3.png') });
  } finally {
    await navegador.close();
  }

  console.log(`Capturas gravadas em ${opcoes.pasta}`);
  for (const r of resultados) {
    console.log(r.erro ? `${r.nome}: ERRO exibido na tela — ${r.erro}` : `${r.nome}: ${r.categoria} | ${r.prioridade} | ${r.modo}`);
  }
}

executar().catch((erro) => {
  console.error('Falha na captura:', erro.message);
  process.exitCode = 1;
});
