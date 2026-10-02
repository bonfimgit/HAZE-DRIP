# Deploy e operação

Arquitetura: **Netlify** (loja `frontend/` e painel `admin/`) → **Railway** (API Node.js + MySQL 8) → **Cloudinary** (imagens), **Mercado Pago** (pagamentos), **Resend** (e-mails).

## 1. Antes de publicar esta versão

1. **Troque as credenciais que estavam no repositório.** Uma versão antiga de `backend/.env.example` tinha valores reais. Gere um novo `JWT_SECRET`, gere novas chaves no Cloudinary e troque a senha do banco, se for a mesma. Atualize tudo no Railway. Trocar o `JWT_SECRET` desloga todo mundo, o que é o esperado.
2. **Faça backup do banco** (seção 6).
3. Publique a API e rode as migrações (seção 3).

## 2. Variáveis de ambiente (Railway → serviço da API → Variables)

Todas estão documentadas em [`backend/.env.example`](../backend/.env.example). Em produção:

| Variável | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Do serviço MySQL do Railway |
| `JWT_SECRET` | 64+ caracteres aleatórios |
| `FRONTEND_URLS` | Domínio(s) do Netlify, ex.: `https://hazedrip.com.br,https://www.hazedrip.com.br` |
| `STORE_URL` | URL pública da loja, ex.: `https://hazedrip.com.br/frontend` |
| `API_URL` | URL pública da API (https) |
| `TZ` / `DB_TIMEZONE` | `America/Sao_Paulo` / `-03:00` (padrão) |
| `CLOUDINARY_*` | Painel do Cloudinary |
| `MERCADOPAGO_ACCESS_TOKEN` | `APP_USR-...` (produção) |
| `MERCADOPAGO_WEBHOOK_SECRET` | Assinatura secreta do webhook |
| `RESEND_API_KEY` / `EMAIL_REMETENTE` | Chave e remetente com domínio verificado |

A API não sobe sem `JWT_SECRET`.

## 3. Migrações do banco

O esquema é versionado em `backend/migrations/`. Cada arquivo roda uma única vez e fica registrado na tabela `schema_migrations`.

```bash
cd backend
npm run migrate
```

- **Banco atual (produção):** a migração `001` usa `CREATE TABLE IF NOT EXISTS` e não altera as tabelas existentes. As seguintes só **adicionam** colunas, índices e tabelas que ainda não existem.
- No Railway: rode localmente apontando o `.env` para o banco de produção (variáveis públicas do MySQL do Railway) ou adicione `npm run migrate &&` antes do comando de start.
- Banco novo: `npm run migrate` cria tudo. Depois crie o gerente: `node criar-admin.js "SenhaForte123"`.

## 4. Mercado Pago

1. Crie uma aplicação em **Suas integrações** e copie o **Access Token** (use o de teste primeiro).
2. Em **Webhooks**, configure a URL `https://<sua-api>/pagamentos/webhook/mercadopago`, marque o evento **Pagamentos** e copie a **assinatura secreta** para `MERCADOPAGO_WEBHOOK_SECRET`.
3. Teste com as contas e cartões de teste do Mercado Pago: compra com PIX e com cartão, pedido mudando para "Pago" sozinho e reembolso pelo painel.
4. Se um webhook se perder, use **Consultar Mercado Pago** no detalhe do pedido. A cada 5 minutos a API também confere os pedidos vencidos antes de cancelá-los.

## 5. E-mails (Resend)

1. Crie a conta em resend.com, adicione e **verifique o domínio** da loja (registros DNS).
2. Gere a API key e configure `RESEND_API_KEY` e `EMAIL_REMETENTE` (ex.: `Haze Drip <pedidos@hazedrip.com.br>`).
3. São enviados: confirmação de e-mail, recuperação de senha e cada mudança de status do pedido.

## 6. Backup e recuperação

- **Railway:** ative os backups do volume do MySQL (aba *Backups* do serviço) com agendamento diário e retenção mínima de 7 dias.
- **Cópia manual** (antes de migrações e mudanças grandes), com as variáveis públicas do MySQL do Railway:
  ```bash
  mysqldump -h <host> -P <porta> -u <usuario> -p --single-transaction --routines <banco> > backup-$(date +%F).sql
  ```
- **Restaurar:** `mysql -h <host> -P <porta> -u <usuario> -p <banco> < backup.sql`. Teste a restauração em um banco separado pelo menos uma vez.
- Arquivos `.sql` estão no `.gitignore`: **nunca** versione backups.

## 7. Monitoramento e alertas

- **Disponibilidade:** cadastre `https://<sua-api>/health` no UptimeRobot (ou similar) a cada 5 minutos, com alerta por e-mail/WhatsApp. Responde 500 se o banco cair.
- **Logs:** a API escreve uma linha JSON por requisição (rota, status, duração). No Railway, filtre por `"nivel":"error"` (erros) e `"Requisição lenta"` (mais de 1 s).
- **Pagamentos a revisar:** o dashboard mostra pedidos com pagamento divergente ou pago após cancelamento.
- **Auditoria:** ações do painel ficam na tabela `auditoria_admin`.

## 8. Netlify (loja e painel)

- Publique a raiz do repositório. A loja fica em `/frontend/` e o painel em `/admin/`.
- A URL da API está em `frontend/script.js` e `admin/config.js` (em `localhost` usa a API local automaticamente).
- Inclua o domínio do Netlify em `FRONTEND_URLS` na API.

## 9. Desenvolvimento local

```bash
cd backend
cp .env.example .env    # ajuste banco e JWT_SECRET
npm install
npm run migrate
node criar-admin.js "SenhaForte123"
npm start               # API em http://localhost:3000
```

Sirva a raiz do repositório na porta 5500 (ex.: Live Server do VS Code ou `python3 -m http.server 5500`) e abra `http://127.0.0.1:5500/frontend/`.

**Testes** (precisam de um MySQL/MariaDB de teste; o banco `haze_drip_test` é apagado a cada execução):

```bash
TEST_DB_USER=root TEST_DB_PASSWORD=senha npm test
```

O GitHub Actions roda os testes contra MySQL 8 a cada push (`.github/workflows/testes.yml`).
