/*
  Cache HTTP curto para respostas públicas do catálogo.
  Reduz requisições repetidas (navegador e CDN) sem atrasar
  muito mudanças de preço e estoque. O preço e o estoque que
  valem na compra são sempre conferidos de novo no checkout.
*/
function cachePublico(segundos) {
  return (req, res, next) => {
    res.setHeader('Cache-Control', `public, max-age=${segundos}`);
    next();
  };
}

module.exports = { cachePublico };
