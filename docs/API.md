# Referência da API

Base: `https://<sua-api>.up.railway.app` (local: `http://localhost:3000`).

- Corpo e respostas em JSON (exceto upload de imagem, multipart).
- Erros: `{ "mensagem": "...", "erro": "..." }` (mesmo texto nos dois campos) com status HTTP adequado.
- Autenticação: `Authorization: Bearer <token>`.
  - **Cliente**: token de 30 minutos + `refresh_token` de 30 dias (rotativo).
  - **Admin**: token de 8 horas; desativar o usuário, mudar o perfil ou trocar a senha encerra as sessões.
- Perfis do painel: **gerente** (tudo) e **operador** (sem usuários, relatórios e reembolsos).

Legenda: 🔓 público · 👤 cliente · 🛠️ admin · 👑 somente gerente

## Loja

| Método | Rota | Acesso | Descrição |
|---|---|---|---|
| GET | `/health` | 🔓 | Saúde da API e do banco (500 se o banco cair) |
| GET | `/catalogo` | 🔓 | Busca/filtros/ordem/paginação: `busca`, `categoria`, `tamanho`, `cor` (listas separadas por vírgula), `preco_min`, `preco_max`, `promocao=1`, `disponivel=1`, `ordem` (`recentes`, `mais_vendidos`, `menor_preco`, `maior_preco`, `avaliacao`, `nome`), `pagina`, `limite` (até 48) |
| GET | `/catalogo/filtros` | 🔓 | Categorias, tamanhos, cores (com contagem) e faixa de preço |
| GET | `/produtos` | 🔓 | Produtos ativos (lista simples) |
| GET | `/produtos/destaques` | 🔓 | Destaques da Home |
| GET | `/produtos/:id` | 🔓 | Produto com imagens, variações e estoque; `preco` já com promoção e `preco_original` |
| GET | `/produtos/:id/variacoes` | 🔓 | Variações ativas |
| GET | `/produtos/:id/imagens` | 🔓 | Imagens |
| GET | `/produtos/:id/relacionados` | 🔓 | Até 4 produtos da mesma categoria com estoque |
| GET | `/produtos/:id/avaliacoes` | 🔓 | Média, distribuição e avaliações (`pagina`) |
| GET | `/categorias` | 🔓 | Categorias ativas |
| GET | `/campanha` | 🔓 | Campanha da Home vigente (404 se não houver) |
| POST | `/carrinho/validar` | 🔓 | `{ itens: [{ variacao_id, quantidade }] }` → preços atuais, estoque e avisos |
| POST | `/checkout/cotacao` | 🔓/👤 | `{ itens, cep, estado, cupom, email }` → subtotal, desconto, frete, total |
| POST | `/checkout` | 🔓/👤 | Cria pedido e pagamento. `{ cliente, endereco \| endereco_id, itens, cupom, metodo_pagamento: "pix" \| "mercadopago", chave_idempotencia }` |
| GET | `/pedidos/:id/acompanhar?token=` | 🔓 | Pedido + pagamento pelo token do pedido (compra sem login) |
| POST | `/pedidos/:id/pagamento` | 🔓 | Gera novo pagamento `{ token, metodo_pagamento }` |
| POST | `/pedidos` | 🔓/👤 | Criação de pedido sem pagamento (compatibilidade) |
| POST | `/pagamentos/webhook/mercadopago` | Mercado Pago | Notificações; assinatura conferida com `MERCADOPAGO_WEBHOOK_SECRET` |

## Conta do cliente

| Método | Rota | Acesso | Descrição |
|---|---|---|---|
| POST | `/clientes/cadastro` | 🔓 | `{ nome, email, telefone?, senha }` → sessão |
| POST | `/clientes/login` | 🔓 | `{ email, senha }` → `{ token, refresh_token, cliente }` |
| POST | `/clientes/refresh` | 🔓 | `{ refresh_token }` → nova sessão (o anterior deixa de valer) |
| POST | `/clientes/logout` | 🔓 | `{ refresh_token }` |
| POST | `/clientes/recuperar-senha` | 🔓 | `{ email }` (resposta igual existindo ou não a conta) |
| POST | `/clientes/redefinir-senha` | 🔓 | `{ token, senha }` |
| POST | `/clientes/verificar-email` | 🔓 | `{ token }` |
| GET/PUT | `/clientes/me` | 👤 | Perfil (`nome`, `telefone`) |
| PATCH | `/clientes/me/senha` | 👤 | `{ senha_atual, senha_nova }` → nova sessão |
| POST | `/clientes/me/reenviar-verificacao` | 👤 | Reenvia o e-mail de confirmação |
| GET | `/clientes/me/dados` | 👤 | LGPD: exporta os dados |
| DELETE | `/clientes/me` | 👤 | LGPD: exclui a conta `{ senha }` |
| GET/POST | `/clientes/me/enderecos` | 👤 | Lista/cria endereço |
| PUT/DELETE | `/clientes/me/enderecos/:id` | 👤 | Edita/remove |
| PATCH | `/clientes/me/enderecos/:id/principal` | 👤 | Define principal |
| GET | `/clientes/me/pedidos` | 👤 | Meus pedidos |
| GET | `/clientes/me/pedidos/:id` | 👤 | Detalhe com itens, histórico e rastreio |
| GET/PUT | `/clientes/me/carrinho` | 👤 | Carrinho salvo; `PUT { itens, mesclar? }` |
| GET/POST | `/clientes/me/avaliacoes` | 👤 | Produtos recebidos / avaliar `{ produto_id, nota 1-5, titulo?, comentario? }` |

## Painel administrativo

| Método | Rota | Acesso | Descrição |
|---|---|---|---|
| POST | `/admin/login` | 🔓 | `{ email, senha }` (5 tentativas a cada 15 min) |
| GET | `/admin/me` | 🛠️ | Usuário logado |
| PATCH | `/admin/me/senha` | 🛠️ | Troca a própria senha → novo token |
| GET/POST | `/admin/usuarios` | 👑 | Lista/cria usuário do painel |
| PUT | `/admin/usuarios/:id` | 👑 | `{ nome, perfil, ativo }` |
| PATCH | `/admin/usuarios/:id/senha` | 👑 | Redefine senha |
| GET | `/admin/produtos`, `/admin/produtos/:id` | 🛠️ | Produtos (inclui inativos) |
| POST / PUT / DELETE | `/produtos`, `/produtos/:id` | 🛠️ | Cria (sempre inativo), edita, desativa |
| PATCH | `/produtos/:id/reativar` | 🛠️ | Exige foto principal, variação ativa e estoque |
| PATCH | `/admin/produtos/:id/destaque` | 🛠️ | `{ destaque_home: true\|false }` |
| POST | `/produtos/:id/imagens` | 🛠️ | Upload (campo `imagem`, JPG/PNG/WEBP até 5 MB) |
| DELETE | `/produtos/:produtoId/imagens/:imagemId` | 🛠️ | Remove imagem |
| PATCH | `/produtos/:produtoId/imagens/:imagemId/principal` | 🛠️ | Define principal |
| GET | `/admin/produtos/:id/variacoes` | 🛠️ | Variações (inclui inativas) |
| POST / PUT / DELETE | `/produtos/:id/variacoes`, `/produtos/:produtoId/variacoes/:variacaoId` | 🛠️ | Variações |
| PATCH | `.../variacoes/:variacaoId/reativar` | 🛠️ | Reativa variação |
| PATCH | `.../variacoes/:variacaoId/estoque` | 🛠️ | `{ estoque }` (ajuste) ou `{ entrada }` (soma), `estoque_minimo?`, `motivo?` |
| GET | `/admin/estoque/baixo`, `/inventario`, `/movimentacoes` | 🛠️ | Estoque |
| GET/POST/PUT/DELETE/PATCH | `/admin/categorias`, `/categorias/:id`, `/categorias/:id/reativar` | 🛠️ | Categorias |
| GET/POST/PUT/DELETE/PATCH | `/admin/campanhas...` | 🛠️ | Campanha da Home e promoções (`inicio_em`, `fim_em`, `desconto_percentual`, `produto_ids`) |
| GET/PATCH | `/admin/avaliacoes`, `/admin/avaliacoes/:id` | 🛠️ | Moderação `{ visivel }` |
| GET | `/admin/pedidos?status=&busca=` | 🛠️ | Pedidos |
| GET | `/admin/pedidos/:id` | 🛠️ | Detalhe com itens e histórico |
| PATCH | `/admin/pedidos/:id/status` | 🛠️ | Próximo status (+ rastreio ao enviar) |
| PATCH | `/admin/pedidos/:id/rastreio` | 🛠️ | `{ codigo_rastreio, transportadora, url_rastreio }` |
| PATCH | `/admin/pedidos/:id/cancelar` | 🛠️ | `{ motivo?, reembolsar? }` (reembolsar: 👑) |
| GET | `/admin/pedidos/:id/pagamentos` | 🛠️ | Pagamentos do pedido |
| POST | `/admin/pedidos/:id/pagamentos/sincronizar` | 🛠️ | Consulta o Mercado Pago de novo |
| POST | `/admin/pedidos/:id/reembolso` | 👑 | `{ valor?, motivo? }` (vazio = total) |
| GET | `/admin/clientes`, `/admin/clientes/:id` | 🛠️ | Clientes |
| PATCH | `/admin/clientes/:id/bloqueio` | 🛠️ | `{ bloqueado, motivo? }` |
| GET/POST/PUT/DELETE | `/admin/frete`, `/admin/frete/:id` | 🛠️ | Regras de frete |
| GET | `/admin/frete/simular?cep=&uf=&valor=` | 🛠️ | Simulador |
| GET/POST/PUT | `/admin/cupons`, `/admin/cupons/:id` | 🛠️ | Cupons |
| GET | `/admin/relatorios/dashboard?de=&ate=` | 🛠️ | Indicadores (datas `AAAA-MM-DD`) |
| GET | `/admin/relatorios/exportar/:tipo` | 👑 | CSV: `pedidos`, `itens`, `estoque`, `movimentacoes`, `clientes` |

## Fluxo do pedido

```
aguardando_pagamento → pago → em_preparacao → enviado → entregue
        │                │          │
        └────────────────┴──────────┴──→ cancelado (devolve estoque e o uso do cupom)
```

- `pago` vem do webhook do Mercado Pago (ou manualmente no painel).
- Sem pagamento no prazo (PIX 30 min, cartão/boleto 3 dias), o pedido é cancelado automaticamente.
- Cada mudança fica no histórico (data, origem e responsável) e gera e-mail ao cliente.
