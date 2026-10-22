# Guia passo a passo · Mini-CRM Inteligente

Tempo estimado: 30 a 45 minutos. Todos os passos rodam localmente, em Windows, sem custo obrigatório.

---

## 1. Pré-requisitos

1. **Node.js 24 ou superior** (exigido pelo n8n 2.x). Instale pelo site oficial e confira no PowerShell:
   ```powershell
   node --version
   npm --version
   ```
2. **Pasta do projeto**: `mini-crm-inteligente` (dentro de `Documentos` ou da Área de Trabalho).
3. **Navegador Chrome ou Edge** (para os testes de navegador; opcional).

## 2. Testar o CRM sem IA

```powershell
cd mini-crm-inteligente
npm install
npm test
npm start
```

Abra **http://localhost:3000**. Cadastre um interessado fictício, altere o status e recarregue a página: os dados devem permanecer.

> Sem o n8n, clicar em "Analisar com IA" mostra o erro "Não foi possível conectar ao webhook do n8n". É o comportamento esperado.

## 3. Instalar e iniciar o n8n

Opção recomendada (sem instalar nada permanentemente):

```powershell
npx n8n
```

Ou instale globalmente: `npm install -g n8n`, depois `n8n start`.

Quando estiver pronto, abra **http://localhost:5678** e crie a conta de proprietário local (ela fica só na sua máquina).

## 4. Importar os workflows

No n8n: **menu ⋯ / Workflows → Import from File**, e selecione:

- `workflow-n8n-ia.json` (análise com IA, Gemini);
- `workflow-n8n-simulacao.json` (análise SEM IA, por regras).

Os dois usam a mesma rota `mini-crm-analise`. **Ative apenas um por vez.**

## 5. Criar a credencial do Gemini (somente no n8n)

1. Gere uma chave gratuita em **https://aistudio.google.com/app/apikey** (disponibilidade depende da conta e da região).
2. No n8n: **Credentials → Create credential** e procure por **Header Auth**.
3. Preencha:
   - **Name**: `x-goog-api-key`
   - **Value**: cole **sua chave aqui**, e somente aqui.
4. Dê um nome à credencial, por exemplo `Gemini API Key (x-goog-api-key)`, e clique em **Save**.

> Não cole a chave no chat, no código, no README nem em nenhum arquivo do projeto. Ela deve ficar apenas na credencial do n8n.

## 6. Ligar a credencial ao nó do Gemini

1. Abra o workflow **Mini-CRM · Análise com IA (Gemini)**.
2. Clique no nó **Gemini: classificar interessado**.
3. Em **Credential for Header Auth**, selecione a credencial criada no passo 5.
4. Confira o modelo na URL do nó (`gemini-2.5-flash`). Se a sua conta não tiver esse modelo, troque pelo nome de um modelo disponível no AI Studio e mantenha o restante da URL.
5. Clique em **Save**.

## 7. Publicar (ativar) o workflow

- Ative o workflow de IA usando **Publish** ou o interruptor **Active**, conforme a interface da sua versão do n8n.
- Garanta que o workflow de simulação **não** esteja ativo.
- A URL de produção é `http://localhost:5678/webhook/mini-crm-analise`.

> A URL `/webhook-test/...` só funciona com o editor aberto e o botão "Listen for test event". Para o CRM, use sempre a URL de produção com o workflow ativo.

## 8. Confirmar a URL usada pelo CRM

O padrão já aponta para `http://localhost:5678/webhook/mini-crm-analise`. Para usar outra URL, defina antes de iniciar:

```powershell
$env:N8N_WEBHOOK_URL = "http://localhost:5678/webhook/mini-crm-analise"
npm start
```

## 9. Testar a integração real

Com o CRM (`npm start`) e o n8n com o workflow ativo, em outro terminal:

```powershell
npm run testar:webhook
```

O script envia os três cenários obrigatórios pelo CRM e imprime categoria, prioridade e modo. Para salvar a saída:

```powershell
npm run testar:webhook -- --salvar evidencias-teste-ao-vivo.txt
```

Também é possível testar pela tela: cadastre cada mensagem e clique em **Analisar com IA**.

No n8n, abra **Executions** para ver a execução de cada chamada. Essa aba é a evidência de que o webhook foi chamado.

## 10. Modo alternativo: simulação SEM IA

Se o Gemini não estiver disponível na sua conta:

1. Desative o workflow de IA.
2. Ative o workflow **Mini-CRM · Simulação SEM IA (regras no n8n)**.
3. Rode `npm run testar:webhook` ou use a tela.

Os cartões mostram **SIMULAÇÃO · regras no n8n, sem IA**. Esse modo deve ser descrito como simulação na entrega; não é IA real.

## 11. Capturas de tela (opcional, geradas pela tela real)

```powershell
npm run capturar -- --salvar-dir capturas
```

O script executa os três cenários pela própria interface e salva as capturas. Só grava o que a tela mostra.

## 12. Montar a pasta de entrega

```powershell
npm run entrega -- --nome "Seu Nome Completo" --capturas capturas --evidencias evidencias
```

Resultado: `ENTREGA/Desafio Sirius Advisory — Seu Nome Completo/` e um `.zip` ao lado. Depois:

1. Grave o vídeo seguindo `ROTEIRO-VIDEO.md` e coloque `demonstracao.mp4` em `03 — Demonstração/`.
2. Revise `CHECKLIST-ENTREGA.md`.
3. Envie a pasta ao Google Drive e configure o compartilhamento como **leitor**, com acesso por link.

---

## Resolução de problemas

| Problema | Solução |
|---|---|
| `npm` não reconhecido | Reinstale o Node.js e abra um novo PowerShell. |
| `npx n8n` falha com versão de Node | Use Node 24 ou superior. |
| Porta 3000 ocupada | `$env:PORT = "3001"` e acesse `http://localhost:3001`. |
| Erro "Credential ... does not exist" no n8n | Selecione a credencial no nó HTTP do Gemini e salve o workflow. |
| Erro de chave inválida do Gemini | Gere uma nova chave no AI Studio e atualize apenas o campo Value da credencial. |
| Quota ou modelo indisponível | Aguarde a renovação da cota, troque o modelo no nó, ou use o workflow de simulação. |
| Webhook responde 404 | O workflow não está ativo, ou a rota não é `mini-crm-analise`. |
