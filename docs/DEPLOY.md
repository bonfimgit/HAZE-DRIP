# Deploy e operação

Arquitetura: **Netlify** (loja `frontend/` e painel `admin/`) → **Render** (API Node.js, plano Free) → **TiDB Cloud Starter** (compatível com MySQL, gratuito) → **Cloudinary** (imagens), **Mercado Pago** (pagamentos), **Resend** (e-mails).

## 1. Antes de publicar esta versão

1. **Troque as credenciais que estavam no repositório.** Uma versão antiga de `backend/.env.example` tinha valores reais. Gere um novo `JWT_SECRET`, gere novas chaves no Cloudinary e troque a senha do banco, se for a mesma. Atualize tudo no Render. Trocar o `JWT_SECRET` desloga todo mundo, o que é o esperado.
2. **Faça backup do banco** (seção 6).
3. Publique a API e rode as migrações (seção 3).

## 2. Render (API)

Serviço **Web Service** ligado a `bonfimgit/HAZE-DRIP`, branch `main`:

| Campo | Valor |
|---|---|
| Root Directory | `backend` |
| Build Command | `npm ci` |
| Start Command | `npm run migrate && npm start` |
| Health Check Path | `/health` |
| Instance Type | Free |

URL atual: `https://haze-drip.onrender.com`. O plano Free dorme após 15 minutos sem acesso; o monitor da seção 7 mantém a API acordada.

## 2.1 Variáveis de ambiente (Render → serviço → Environment)

Todas estão documentadas em [`backend/.env.example`](../backend/.env.example). Em produção:

| Variável | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` | TiDB Cloud → instância → **Connect** (porta `4000`; o usuário tem um prefixo, ex.: `abc123.root`) |
| `DB_NAME` | `haze_drip` (criado na seção 2.2) |
| `DB_SSL` | `true` (o TiDB Cloud exige SSL com certificado público; deixe `DB_SSL_CA` e `DB_SSL_CA_FILE` vazios) |
| `JWT_SECRET` | 64+ caracteres aleatórios |
| `FRONTEND_URLS` | Domínio(s) do Netlify, ex.: `https://hazedrip.com.br,https://www.hazedrip.com.br` |
| `STORE_URL` | URL pública da loja, ex.: `https://hazedrip.com.br/frontend` |
| `API_URL` | URL pública da API (https) |
| `TZ` / `DB_TIMEZONE` | `America/Sao_Paulo` / `-03:00` (padrão) |
| `CLOUDINARY_*` | Painel do Cloudinary |
| `MERCADOPAGO_ACCESS_TOKEN` | `APP_USR-...` (produção) |
| `MERCADOPAGO_WEBHOOK_SECRET` | Assinatura secreta do webhook |
| `CHECKOUT_LIMITE_POR_HORA` | Pedidos criados por IP por hora (opcional, padrão 10) |
| `RESEND_API_KEY` / `EMAIL_REMETENTE` | Chave e remetente com domínio verificado |
| `MELHOR_ENVIO_TOKEN`, `MELHOR_ENVIO_CEP_ORIGEM` | Frete calculado pelo Melhor Envio (gratuito, seção 4.0) |
| `CORREIOS_*` / `FRETE_*` | Frete pela API dos Correios com contrato (opcional, seção 4.1) e ajustes do pacote |

A API não sobe sem `JWT_SECRET`.

## 2.2 Banco de dados (TiDB Cloud Starter)

Gratuito (5 GiB, sem cartão), compatível com MySQL e não é desligado por falta de uso.

1. Crie a conta em [tidbcloud.com](https://tidbcloud.com) e uma instância **Starter**. Escolha uma região AWS perto da região do Render (ex.: Render em Virginia → `us-east-1`).
2. Na instância, abra **Connect**, gere a senha e copie host, porta, usuário e senha.
3. Abra o **SQL Editor** da instância e crie o banco:
   ```sql
   CREATE DATABASE haze_drip;
   ```
4. Preencha as variáveis `DB_*` no Render (tabela acima) e faça o deploy. As migrações criam todas as tabelas.
5. Banco novo não tem administrador: defina `ADMIN_EMAIL` e `ADMIN_SENHA` no Render antes do deploy (seção 3) e apague depois do primeiro login.

O CI roda todos os testes também contra o TiDB (job `testes-tidb`).

## 3. Migrações do banco

O esquema é versionado em `backend/migrations/`. Cada arquivo roda uma única vez e fica registrado na tabela `schema_migrations`.

```bash
cd backend
npm run migrate
```

- **Banco atual (produção):** a migração `001` usa `CREATE TABLE IF NOT EXISTS` e não altera as tabelas existentes. As seguintes só **adicionam** colunas, índices e tabelas que ainda não existem.
- No Render as migrações rodam a cada início (`npm run migrate && npm start`); se nada estiver pendente, não fazem nada.
- Banco novo: `npm run migrate` cria tudo. Para o primeiro gerente, defina `ADMIN_EMAIL` e `ADMIN_SENHA` (8+ caracteres; `ADMIN_NOME` opcional) e rode o migrate (no Render, basta um deploy). Só cria se não houver nenhum admin; apague as variáveis depois do primeiro login. Localmente também funciona `node criar-admin.js "SenhaForte123"`.

## 4. Mercado Pago

1. Crie uma aplicação em **Suas integrações** e copie o **Access Token** (use o de teste primeiro).
2. Em **Webhooks**, configure a URL `https://<sua-api>/pagamentos/webhook/mercadopago`, marque o evento **Pagamentos** e copie a **assinatura secreta** para `MERCADOPAGO_WEBHOOK_SECRET`.
3. Teste com as contas e cartões de teste do Mercado Pago: compra com PIX e com cartão, pedido mudando para "Pago" sozinho e reembolso pelo painel.
4. Se um webhook se perder, use **Consultar Mercado Pago** no detalhe do pedido. A cada 5 minutos a API também confere os pedidos vencidos antes de cancelá-los.

## 4.0 Frete pelo Melhor Envio (recomendado, gratuito)

Cota Correios PAC e SEDEX (e outras transportadoras, se quiser) sem contrato. A conta e a cotação são gratuitas; paga-se só a etiqueta, comprada no Melhor Envio.

1. Crie a conta em [melhorenvio.com.br](https://melhorenvio.com.br) e gere um **token** no painel da conta (área de integrações/tokens).
2. No Render, preencha:
   - `MELHOR_ENVIO_TOKEN`: o token (só o texto do token, sem "Bearer").
   - `MELHOR_ENVIO_CEP_ORIGEM`: o CEP de onde os pacotes saem.
   - Opcionais: `MELHOR_ENVIO_SERVICOS` (padrão `1,2` = PAC e SEDEX; `17` = Mini Envios, `3,4` = Jadlog), `MELHOR_ENVIO_AMBIENTE=sandbox` para usar um token do ambiente de testes, `MELHOR_ENVIO_CONTATO` (e-mail técnico enviado no User-Agent).
3. Ajuste o pacote em `FRETE_PESO_ITEM_GRAMAS` (peso de cada peça já embalada) e `FRETE_EMBALAGEM_CM` (`comprimento x largura x altura`).
4. Teste em **Frete → Simular**: deve aparecer "Melhor Envio — Correios PAC: R$ ..., Correios SEDEX: R$ ...".

Regras:
- O valor cotado é o da etiqueta do Melhor Envio. Se for postar pagando no balcão da agência, use `FRETE_ADICIONAL` para cobrir a diferença.
- O valor dos produtos vai como valor segurado (o mesmo na cotação e no pedido).
- O "grátis acima de" da regra do CEP vale para a opção mais barata.
- Se o Melhor Envio não responder (ou o token for inválido), o frete cai na tabela do painel e o log mostra `Cotação de frete falhou`. Mantenha a regra padrão (Brasil) ativa.
- Com Melhor Envio e Correios configurados, vale o Melhor Envio.

## 4.1 Frete pelos Correios

Sem as variáveis `CORREIOS_*`, o frete vem só da tabela do painel (**Frete**). Com elas, o checkout cota PAC e SEDEX na API dos Correios assim que o cliente informa o CEP, e o cliente escolhe a opção.

1. É preciso **contrato com os Correios** e os serviços **API Preços** e **API Prazo** liberados no cartão de postagem (fale com o seu consultor comercial).
2. Em [cws.correios.com.br](https://cws.correios.com.br), entre com o usuário do contrato e gere o **código de acesso** às APIs.
3. No Render, preencha `CORREIOS_USUARIO`, `CORREIOS_CODIGO_ACESSO`, `CORREIOS_CARTAO_POSTAGEM` e `CORREIOS_CEP_ORIGEM`. Se quiser o preço do contrato, preencha também `CORREIOS_CONTRATO` e `CORREIOS_DR`. Confira os códigos dos serviços do seu contrato em `CORREIOS_SERVICOS` (padrão `03298:PAC,03220:SEDEX`).
4. Ajuste o pacote: `FRETE_PESO_ITEM_GRAMAS` (peso de cada peça embalada), `FRETE_EMBALAGEM_CM` (caixa) e, se quiser, `FRETE_ADICIONAL` (R$ somado à cotação) e `FRETE_DIAS_POSTAGEM` (dias somados ao prazo).
5. Teste em **Frete → Simular** no painel: com os Correios ativos, aparecem os valores de cada serviço.

A tabela do painel continua valendo:
- o **frete grátis** ("grátis acima de") da regra do CEP vale para a opção mais barata dos Correios;
- se os Correios não responderem, o frete cai na regra da tabela. Mantenha a regra padrão (Brasil) ativa.

As cotações ficam 30 minutos em cache por CEP e peso, e falhas aparecem no log como `Cotação de frete falhou`.

## 5. E-mails (Resend)

1. Crie a conta em resend.com, adicione e **verifique o domínio** da loja (registros DNS).
2. Gere a API key e configure `RESEND_API_KEY` e `EMAIL_REMETENTE` (ex.: `Haze Drip <pedidos@hazedrip.com.br>`).
3. São enviados: confirmação de e-mail, recuperação de senha e cada mudança de status do pedido.
4. **Fila de e-mails:** todo e-mail é gravado na tabela `email_fila` e enviado na hora. Se o Resend falhar ou o Render reiniciar no meio, a API tenta de novo a cada minuto (1, 2, 4, 8... minutos entre as tentativas). Depois de 8 falhas o e-mail fica como `falhou` e aparece no log. Os enviados são apagados depois de 30 dias.
   Para ver o que não saiu:
   ```sql
   SELECT id, para, assunto, status, tentativas, ultimo_erro, criado_em
   FROM email_fila WHERE status IN ('pendente', 'falhou') ORDER BY id DESC;
   ```

## 6. Backup e recuperação

- **TiDB Cloud:** confira na console da instância o que o plano Starter oferece de backup e não dependa só disso: faça a cópia manual abaixo com frequência.
- **Cópia manual** (antes de migrações e mudanças grandes), com os dados de conexão do TiDB Cloud:
  ```bash
  mysqldump -h <host> -P 4000 -u <usuario> -p --ssl-mode=VERIFY_IDENTITY --single-transaction --no-tablespaces --set-gtid-purged=OFF <banco> > backup-$(date +%F).sql
  ```
- **Restaurar:** `mysql -h <host> -P 4000 -u <usuario> -p --ssl-mode=VERIFY_IDENTITY <banco> < backup.sql`. Teste a restauração em um banco separado pelo menos uma vez.
- Arquivos `.sql` estão no `.gitignore`: **nunca** versione backups.

## 7. Monitoramento e alertas

- **Disponibilidade:** cadastre `https://<sua-api>/health` no UptimeRobot (ou similar) a cada 5 minutos, com alerta por e-mail/WhatsApp. Responde 500 se o banco cair.
- **Logs:** a API escreve uma linha JSON por requisição (rota, status, duração). No Render (aba *Logs*), filtre por `"nivel":"error"` (erros) e `"Requisição lenta"` (mais de 1 s).
- **Pagamentos a revisar:** o dashboard mostra pedidos com pagamento divergente ou pago após cancelamento.
- **Auditoria:** ações do painel ficam na tabela `auditoria_admin`.

## 8. Netlify (loja e painel)

- Publique a raiz do repositório (configurado em `netlify.toml`). A loja fica em `/frontend/` e o painel em `/admin/` (abre o `login.html`); a raiz `/` redireciona para a loja e links antigos `/hazedrip/...` continuam funcionando.
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
