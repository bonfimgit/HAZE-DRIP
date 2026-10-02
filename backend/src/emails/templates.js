/*
  Modelos dos e-mails transacionais.
  HTML simples com estilos inline (compatível com a maioria dos clientes de e-mail).
*/

const config = require('../config/ambiente');

function escapar(valor) {
  return String(valor ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function moeda(valor) {
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function link(caminho) {
  return `${config.urlLoja}/${caminho.replace(/^\/+/, '')}`;
}


function layout(titulo, conteudo) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#111;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;">
        <tr><td style="background:#060506;color:#ffffff;padding:20px 28px;font-size:20px;font-weight:bold;letter-spacing:2px;">HAZE DRIP</td></tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 16px;font-size:22px;">${escapar(titulo)}</h1>
          ${conteudo}
        </td></tr>
        <tr><td style="padding:18px 28px;background:#fafafa;color:#777;font-size:12px;">
          Você recebeu este e-mail porque possui cadastro ou pedido na Haze Drip.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}


function botao(texto, url) {
  return `<p style="margin:24px 0;"><a href="${escapar(url)}" style="background:#060506;color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:bold;">${escapar(texto)}</a></p>`;
}


function tabelaItens(itens) {

  const linhas = itens.map(item => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee;">
        ${escapar(item.produto_nome)}<br>
        <span style="color:#777;font-size:12px;">${escapar(item.cor)} / ${escapar(item.tamanho)} · ${Number(item.quantidade)}x</span>
      </td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">${moeda(item.subtotal)}</td>
    </tr>`).join('');

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">${linhas}</table>`;
}


function resumoValores(pedido) {

  const desconto = Number(pedido.desconto || 0) > 0
    ? `<tr><td>Desconto</td><td style="text-align:right;">- ${moeda(pedido.desconto)}</td></tr>`
    : '';

  return `<table role="presentation" width="100%" cellpadding="4" cellspacing="0" style="font-size:14px;margin-top:12px;">
    <tr><td>Subtotal</td><td style="text-align:right;">${moeda(pedido.subtotal)}</td></tr>
    ${desconto}
    <tr><td>Frete</td><td style="text-align:right;">${moeda(pedido.frete)}</td></tr>
    <tr><td><strong>Total</strong></td><td style="text-align:right;"><strong>${moeda(pedido.total)}</strong></td></tr>
  </table>`;
}


/* =============================================================
   CONTA DO CLIENTE
============================================================= */

function verificacaoEmail({ nome, token }) {
  const url = link(`verificar-email.html?token=${encodeURIComponent(token)}`);
  return {
    assunto: 'Confirme seu e-mail — Haze Drip',
    html: layout(`Olá, ${nome}!`, `
      <p>Confirme seu e-mail para concluir o cadastro na Haze Drip.</p>
      ${botao('Confirmar e-mail', url)}
      <p style="color:#777;font-size:12px;">O link vale por 48 horas.</p>`),
    texto: `Olá, ${nome}! Confirme seu e-mail: ${url}`
  };
}


function recuperacaoSenha({ nome, token }) {
  const url = link(`redefinir-senha.html?token=${encodeURIComponent(token)}`);
  return {
    assunto: 'Redefinição de senha — Haze Drip',
    html: layout('Redefinir senha', `
      <p>Olá, ${escapar(nome)}. Recebemos um pedido para redefinir sua senha.</p>
      ${botao('Criar nova senha', url)}
      <p style="color:#777;font-size:12px;">O link vale por 1 hora. Se não foi você, ignore este e-mail: sua senha continua a mesma.</p>`),
    texto: `Redefina sua senha (válido por 1 hora): ${url}`
  };
}


/* =============================================================
   PEDIDOS
============================================================= */

const TITULOS_STATUS = {
  aguardando_pagamento: 'Pedido recebido',
  pago: 'Pagamento aprovado',
  em_preparacao: 'Seu pedido está em preparação',
  enviado: 'Seu pedido foi enviado',
  entregue: 'Pedido entregue',
  cancelado: 'Pedido cancelado'
};

const TEXTOS_STATUS = {
  aguardando_pagamento: 'Recebemos seu pedido. Assim que o pagamento for confirmado, começamos a separar seus produtos.',
  pago: 'Seu pagamento foi aprovado. Em breve seu pedido entra em preparação.',
  em_preparacao: 'Estamos separando e embalando seus produtos.',
  enviado: 'Seu pedido saiu para entrega.',
  entregue: 'Seu pedido foi entregue. Esperamos que você curta!',
  cancelado: 'Seu pedido foi cancelado. Se o pagamento já tinha sido feito, o reembolso será processado pela mesma forma de pagamento.'
};


function statusPedido(pedido) {

  const titulo = TITULOS_STATUS[pedido.status] || 'Atualização do pedido';

  const rastreio = pedido.status === 'enviado' && pedido.codigo_rastreio
    ? `<p><strong>Código de rastreio:</strong> ${escapar(pedido.codigo_rastreio)}${pedido.transportadora ? ` (${escapar(pedido.transportadora)})` : ''}</p>
       ${pedido.url_rastreio ? botao('Acompanhar entrega', pedido.url_rastreio) : ''}`
    : '';

  const pagamento = pedido.status === 'aguardando_pagamento' && pedido.pagamento_url
    ? botao('Pagar agora', pedido.pagamento_url)
    : '';

  return {
    assunto: `${titulo} — Pedido #${pedido.id}`,
    html: layout(`${titulo} — #${pedido.id}`, `
      <p>Olá, ${escapar(pedido.cliente_nome)}.</p>
      <p>${TEXTOS_STATUS[pedido.status] || ''}</p>
      ${pagamento}
      ${rastreio}
      ${tabelaItens(pedido.itens || [])}
      ${resumoValores(pedido)}
      ${botao('Ver meus pedidos', link('minha-conta.html#pedidos'))}`),
    texto: `${titulo} — Pedido #${pedido.id}. ${TEXTOS_STATUS[pedido.status] || ''}`
  };
}


module.exports = {
  verificacaoEmail,
  recuperacaoSenha,
  statusPedido
};
