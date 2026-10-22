# Roteiro do vídeo · até 3 minutos

**Gravação:** tela inteira, 1080p, voz clara. Use **somente dados fictícios**. Não mostre chaves de API, abas com e-mails pessoais nem o conteúdo da credencial do n8n.

**Antes de gravar**

- [ ] CRM rodando em `http://localhost:3000` (`npm start`).
- [ ] n8n aberto com o workflow ATIVO (IA ou simulação; indique qual no vídeo).
- [ ] Armazenamento do navegador limpo, para a lista começar vazia.
- [ ] Notificações do sistema desligadas.

## 0:00–0:30 · Tela principal

Mostrar a tela do CRM: cabeçalho, indicadores, formulário à esquerda e lista à direita. Dizer em uma frase o objetivo: acompanhar interessados e sugerir respostas comerciais com IA via n8n.

## 0:30–1:00 · Cadastrar e alterar status

- Preencher nome, WhatsApp e mensagem de um interessado fictício.
- Mostrar a validação: enviar um campo vazio e mostrar a mensagem amigável.
- Cadastrar, mostrar o cartão com status "Novo" e alterar para "Em atendimento".
- Recarregar a página (F5) e mostrar que os dados permanecem.

## 1:00–2:00 · Analisar com IA e mostrar o retorno

- Clicar em **Analisar com IA** no cartão do Teste 2: *"Já tenho cédula paraguaia e quero contratar o serviço de abertura de EAS."*
- Mostrar o estado de carregamento e o botão desativado durante a análise.
- Mostrar o retorno: categoria, prioridade, resposta sugerida e o selo do modo.
  - Se for IA real: "IA real (Gemini via n8n)".
  - Se for simulação: falar explicitamente "modo simulação, regras no n8n, sem IA".
- Explicar que a resposta é só uma sugestão, não é enviada.
- Opcional: mostrar o Teste 1 (dúvida, prioridade Média) e o Teste 3 (pesquisa, prioridade Baixa).

## 2:00–2:30 · Workflow no n8n

- Abrir o workflow no n8n: webhook POST, nós de validação, chamada ao Gemini (ou regras), validação da resposta e Respond to Webhook.
- Abrir **Executions** e mostrar a execução correspondente à análise feita agora.
- Mostrar que a credencial existe, sem abrir o valor da chave.

## 2:30–3:00 · Tecnologia em uma frase cada

- **Front-end:** HTML, CSS e JavaScript puros, com localStorage para persistência.
- **Proxy Node:** recebe `POST /api/analisar`, valida, aplica timeout e traduz erros.
- **n8n:** orquestra a classificação e garante o contrato JSON de saída.
- **Gemini:** classifica o interessado, com saída estruturada e validada.
- Encerrar mencionando a suíte de testes (`npm test`) e os três cenários obrigatórios.

---

**Checagem final antes de exportar:** o vídeo tem no máximo 3:00; nenhum dado real aparece; o modo exibido na tela (IA ou simulação) corresponde ao que o vídeo afirma.
