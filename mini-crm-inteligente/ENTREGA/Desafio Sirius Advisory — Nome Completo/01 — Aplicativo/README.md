# Mini-CRM Inteligente · Sirius Advisory

CRM local para acompanhar interessados em abertura de empresas no Paraguai, documentação, consultorias e produtos digitais. Cada interessado pode ser analisado por um workflow do **n8n** que classifica o contato e sugere uma resposta comercial. A sugestão é exibida na tela e **nunca é enviada** a ninguém.

> Todos os dados de exemplo são fictícios. Não há envio de WhatsApp, login, banco remoto nem hospedagem pública.

## Requisitos

| Item | Versão testada | Observação |
|---|---|---|
| Node.js (aplicativo e testes) | 22.22.0 | Testado no Node 22. O `package.json` declara Node 20 ou superior, sem testes nessa versão. Sem dependências de execução. |
| n8n | 2.44.5 | **Exige Node.js 24 ou superior** para rodar. |
| Chromium/Chrome | 141 | Só para os testes de navegador. Opcional. |
| Chave do Gemini | — | Necessária apenas para a análise com IA real. Vai **somente** na credencial do n8n. |

## Como executar (Windows, PowerShell)

```powershell
cd mini-crm-inteligente
node --version
npm install          # instala apenas o playwright-core usado nos testes de navegador
npm test             # executa a suíte automatizada
npm start            # sobe o CRM em http://localhost:3000
```

Para apontar para outro webhook (por exemplo, o n8n em outra porta):

```powershell
$env:N8N_WEBHOOK_URL = "http://localhost:5678/webhook/mini-crm-analise"
npm start
```

Veja `GUIA-PASSO-A-PASSO.md` para instalar o n8n, importar os workflows e configurar a chave do Gemini.

## Arquitetura

```
Navegador (HTML/CSS/JS)  ──POST /api/analisar──▶  Servidor Node (server.js + src/proxy.js)
   localStorage                                         │  valida entrada, timeout, erros
                                                        ▼
                                          n8n: Webhook POST /webhook/mini-crm-analise
                                                        │
                    ┌───────────────────────────────────┴──────────────────────────────┐
                    ▼                                                                  ▼
  workflow-n8n-ia.json (IA real)                                  workflow-n8n-simulacao.json
  Validar → Entrada válida? → Gemini (HTTP + Header Auth)         Regras determinísticas DENTRO do n8n
  → Validar resposta → Respond to Webhook                         → Respond to Webhook  (modo "simulacao")
  (modo "ia")
```

Somente **um** workflow pode estar ativo por vez, porque os dois usam a mesma rota de produção.

### Estrutura

```
server.js                  servidor HTTP: interface estática + POST /api/analisar
src/proxy.js               encaminha ao n8n, aplica timeout e traduz erros para mensagens úteis
src/config.js              variáveis de ambiente (PORT, N8N_WEBHOOK_URL, TEMPO_LIMITE_MS)
public/index.html          interface
public/css/styles.css      visual responsivo (azul-marinho, off-white e azul vivo)
public/js/contrato.js      contrato compartilhado: validação de entrada e de saída (navegador e Node)
public/js/crm.js           regras do CRM: cadastro, status, filtro, indicadores, localStorage, chamada à análise
public/js/app.js           ligação com o DOM (sem innerHTML com dados do usuário)
n8n/codigo/*.js            código dos nós Code do n8n (fonte única dos workflows)
n8n/workflow-n8n-ia.json           workflow com IA (Gemini) — gerado
n8n/workflow-n8n-simulacao.json    workflow SEM IA (regras) — gerado
scripts/gerar-workflows.js         gera os JSON a partir de n8n/codigo/
scripts/testar-webhook.js          teste ao vivo dos três cenários contra o CRM rodando
scripts/capturar-interface.js      gera capturas reais da tela executando os três cenários
scripts/montar-entrega.js          monta ENTREGA/ e o zip
tests/                             suíte automatizada (node:test)
```

## Decisões técnicas

- **Sem framework.** HTML, CSS e JavaScript puros; servidor com `node:http`. Não há dependência de execução, o que simplifica a execução no Windows.
- **Proxy local.** O navegador nunca conhece a URL do n8n nem qualquer chave. Também evita CORS.
- **Contrato único.** `public/js/contrato.js` valida a entrada e a saída tanto no servidor quanto na tela. Uma saída fora do contrato vira erro explícito, nunca dado exibido.
- **Código do n8n em arquivos próprios.** Os nós Code vêm de `n8n/codigo/`, e o JSON é gerado a partir deles. Os testes executam esse mesmo código, então o que é testado é o que é importado no n8n.
- **Gemini por Header Auth.** O nó HTTP Request usa a credencial nativa do n8n com o cabeçalho `x-goog-api-key`. Nenhuma chave aparece no JSON, no código ou no repositório.
- **Saída estruturada e validada duas vezes.** O pedido ao Gemini usa `responseSchema` com enums; depois, o n8n valida de novo, normaliza `Media` para `Média` e rejeita categorias fora da lista.
- **Minimização de dados.** Ao modelo vão a mensagem e o primeiro nome. O WhatsApp não é enviado.
- **Mensagem do contato é não confiável.** Ela é isolada em tags, tags forjadas são neutralizadas, e as instruções reforçam que o texto não deve ser seguido.
- **Simulação identificada.** Quando o modo é `simulacao`, o cartão mostra "SIMULAÇÃO · regras no n8n, sem IA". Não se apresenta como IA.
- **localStorage.** Contatos, status e análises ficam no navegador. Dados corrompidos geram aviso e não derrubam a tela.

## Testes

`npm test` executa 82 testes. Cinco deles, de navegador, são pulados automaticamente se o `playwright-core` (após `npm install`) ou o Chromium não estiverem disponíveis; isso aparece no relatório como `skipped`.

- **Contrato** (validação de entrada e saída, normalização de prioridade);
- **Regras do CRM** (cadastro, status, filtros, indicadores, persistência, dados corrompidos, mensagens de erro do cliente);
- **Proxy HTTP** com webhook **MOCK** local (sucesso, offline, timeout, HTTP 500, JSON malformado, contrato inválido, entrada inválida, corpo grande);
- **Servidor HTTP real** (rotas, 405, bloqueio de caminho fora de `public/`);
- **Workflows n8n** (sincronia do JSON com o gerador, ausência de chaves, credencial Header Auth, execução dos nós Code com respostas **MOCK** do Gemini);
- **Três testes obrigatórios** (regras reais do workflow de simulação e validação com **MOCK** da IA);
- **Interface em navegador** (Playwright + Chromium real: validação, persistência após reload, status, n8n offline, selo de simulação, proteção contra XSS). Pulados automaticamente se não houver Chromium; para usar outro, defina `CHROME_PATH`.

Teste ao vivo (não é mock): com o CRM e o n8n em execução, rode `npm run testar:webhook`.

> Os testes com MOCK não comprovam que o Gemini respondeu. Essa comprovação só existe com a chave configurada e uma execução real, registrada no painel de Executions do n8n.

## Resolução de erros

| Mensagem na tela | Causa provável | O que fazer |
|---|---|---|
| "Não foi possível conectar ao webhook do n8n" | n8n desligado, ou workflow não está ATIVO | Ligue o n8n e ative o workflow. Confira `N8N_WEBHOOK_URL`. |
| "Não foi possível falar com o servidor do CRM" | `npm start` não está rodando | Rode `npm start` na pasta do projeto. |
| "O n8n respondeu com um erro HTTP" | Erro dentro do workflow | Abra a aba Executions no n8n e leia o nó que falhou. |
| "O workflow de IA não conseguiu consultar o Gemini" | Credencial ausente, inválida, ou modelo indisponível na conta | Confira a credencial "Gemini API Key" e o nome do modelo no nó HTTP. |
| "O n8n demorou demais" | Timeout | Tente novamente; aumente `TEMPO_LIMITE_MS` se necessário. |
| Lista começou vazia com aviso de dados ilegíveis | localStorage com conteúdo corrompido | Os dados não são apagados automaticamente; limpe o armazenamento do site se quiser recomeçar. |
| "Address already in use" ao subir o CRM | Porta 3000 ocupada | Defina outra porta: `$env:PORT = "3001"`. |

## Limitações conhecidas

- A análise com IA real depende de uma chave do Gemini configurada pelo candidato. Neste repositório **não há chave**, e o workflow de IA foi executado no n8n local apenas com um Gemini **MOCK**.
- O modelo padrão configurado é `gemini-2.5-flash`. Disponibilidade, cotas e região dependem da conta do Google AI Studio.
- Os dados ficam só no navegador onde foram cadastrados (localStorage).
- A saída da IA pode variar entre execuções, mesmo com temperatura baixa.
