# Evidências de execução (registros reais)

**Modo desta execução: SIMULAÇÃO — regras determinísticas dentro do n8n, sem IA.**

Ambiente: n8n 2.44.5 local (Node 24) com o workflow `workflow-n8n-simulacao.json` ativo; CRM em `npm start` (Node 22); captura de tela feita pelo script `npm run capturar` com Chromium.

Arquivos:

- `evidencia-teste-ao-vivo-SIMULACAO.txt`: saída real de `npm run testar:webhook` (CRM → proxy → webhook do n8n). Os três cenários retornaram HTTP 200 com `modo: simulacao`.
- `evidencia-tela-teste1-SIMULACAO.png`, `evidencia-tela-teste2-SIMULACAO.png`, `evidencia-tela-teste3-SIMULACAO.png`: cartões da interface após a análise, mostrando o selo SIMULAÇÃO.

Não há nesta pasta nenhum resultado de IA real (Gemini). Quando houver chave configurada, as evidências do modo IA devem ser geradas de nova execução e colocadas em pasta separada.
