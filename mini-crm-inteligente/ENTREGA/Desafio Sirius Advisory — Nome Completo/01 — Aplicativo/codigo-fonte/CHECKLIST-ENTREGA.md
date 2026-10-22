# Checklist de entrega · Mini-CRM Inteligente

Marque somente o que você conferiu. Itens com **[REAL]** exigem evidência gerada por execução real.

## Código e aplicativo

- [ ] `npm install` e `npm test` executados; resultado registrado (82 testes no ambiente de referência).
- [ ] `npm start` sobe o CRM em `http://localhost:3000` sem erros.
- [ ] Cadastro, validação, listagem, alteração de status e persistência após recarregar funcionam.
- [ ] Botão **Analisar com IA** envia exatamente nome, WhatsApp e mensagem ao webhook do n8n.
- [ ] Carregamento visível e botão desativado durante a análise.
- [ ] Erros úteis para: webhook offline, HTTP inválido, timeout e JSON malformado.
- [ ] Modo exibido na tela: "IA real" ou "SIMULAÇÃO", conforme o workflow ativo.
- [ ] Layout testado em tela de desktop e em tela estreita (celular).
- [ ] Nenhum arquivo contém chave de API, token ou senha.

## Automação n8n

- [ ] `workflow-n8n-ia.json` importa sem erro no n8n.
- [ ] `workflow-n8n-simulacao.json` importa sem erro no n8n.
- [ ] Credencial **Header Auth** (`x-goog-api-key`) criada **somente** no n8n.
- [ ] Workflow de IA publicado/ativo; workflow de simulação **desativado** ao mesmo tempo.
- [ ] Rota de produção `/webhook/mini-crm-analise` testada (não a `/webhook-test/`).
- [ ] **[REAL]** Execução de IA real com o Gemini registrada no painel Executions. *(Pendente: depende da chave do candidato.)*
- [ ] **[REAL]** Execução em modo simulação registrada no painel Executions, se a simulação for entregue como alternativa.

## Testes obrigatórios

- [ ] **Teste 1 · Dúvidas** — prioridade Média, categoria Consultoria, sem orientação definitiva.
- [ ] **Teste 2 · Pronto para contratar** — prioridade Alta, categoria Abertura de empresa, encaminhamento comercial.
- [ ] **Teste 3 · Pesquisando** — prioridade Baixa, categoria Produtos digitais, conteúdo educativo.
- [ ] **[REAL]** Capturas dos três testes na tela, com o modo visível.

## Documentação

- [ ] `README.md`: o que é, decisões técnicas, arquitetura, como executar no Windows, URLs, erros e limitações.
- [ ] `GUIA-PASSO-A-PASSO.md`: instalação, n8n, importação, credencial, publicação, URL, testes e simulação.
- [ ] `ROTEIRO-VIDEO.md`: roteiro com os tempos exigidos e limite de 3 minutos.
- [ ] Este checklist revisado.

## Pasta de entrega (`ENTREGA/`)

- [ ] `01 — Aplicativo/codigo-fonte/` sem `node_modules` e sem `.env`.
- [ ] `01 — Aplicativo/README.md` presente.
- [ ] `01 — Aplicativo/captura-interface.png` **[REAL]** (ou o aviso PENDENTE, se ainda não houver captura real).
- [ ] `02 — Automação/workflow-n8n-ia.json` e `workflow-n8n-simulacao.json`.
- [ ] `02 — Automação/evidencias/` com somente capturas e registros reais, identificados por modo.
- [ ] `03 — Demonstração/README-VIDEO.md` e `demonstracao.mp4` **[REAL]** gravado pelo candidato (até 3 minutos).
- [ ] Zip gerado e conferido.

## Google Drive

- [ ] Pasta enviada ao Google Drive.
- [ ] Compartilhamento por link configurado como **leitor** (somente depois de conferir o conteúdo).
- [ ] Link testado em uma janela anônima.
