# Checklist de entrada em produção

Marque cada item antes de divulgar a loja.

## Configuração

- [ ] Credenciais antigas trocadas (JWT, Cloudinary, banco). Veja [DEPLOY.md](DEPLOY.md#1-antes-de-publicar-esta-versão)
- [ ] Backup do banco feito e restauração testada
- [ ] `npm run migrate` executado sem erros
- [ ] Variáveis de produção configuradas (`NODE_ENV=production`, URLs https)
- [ ] Mercado Pago em modo produção, webhook com assinatura secreta
- [ ] Domínio verificado no Resend e e-mail de teste recebido
- [ ] Monitor de `/health` ativo com alerta
- [ ] Backups automáticos do MySQL ativos no Railway

## Conteúdo

- [ ] Preencher os campos `[PREENCHER: ...]` em `privacidade.html`, `termos.html`, `trocas.html`, `sobre.html` e `contato.html` (razão social, CNPJ, endereço, e-mails, prazos)
- [ ] Revisão jurídica das políticas
- [ ] Guia de medidas (link "Guia de medidas" na página de produto)
- [ ] Regras de frete revisadas (padrão: R$ 25, grátis acima de R$ 399)
- [ ] Produtos com foto, variações, estoque e estoque mínimo
- [ ] Usuários do painel criados com o perfil certo (gerente/operador)

## Testes em produção (com valores baixos)

- [ ] **Compra:** visitante e cliente logado, com e sem cupom
- [ ] **Pagamento:** PIX aprovado → pedido vira "Pago" sozinho; cartão; boleto
- [ ] **Expiração:** PIX não pago → pedido cancelado e estoque devolvido em até ~35 min
- [ ] **Estoque:** venda baixa o estoque; dois clientes não compram a última unidade
- [ ] **Cancelamento:** devolve estoque e o uso do cupom
- [ ] **Reembolso:** parcial e total pelo painel; valor volta no Mercado Pago
- [ ] **Painel:** fluxo pago → preparação → enviado (com rastreio) → entregue; e-mails recebidos em cada etapa
- [ ] **Conta:** cadastro, confirmação de e-mail, recuperação de senha, endereços, Meus pedidos, avaliação após entrega
- [ ] **LGPD:** baixar dados e excluir conta
- [ ] **Mobile:** navegação, filtros, sacola, checkout e PIX no celular
- [ ] **Segurança:** painel inacessível sem login; operador sem acesso a relatórios/usuários/reembolso
- [ ] **Relatórios:** dashboard e CSV batem com os pedidos de teste

## Depois de publicar

- [ ] Cancelar/reembolsar os pedidos de teste
- [ ] Acompanhar logs de erro e pagamentos a revisar nos primeiros dias
