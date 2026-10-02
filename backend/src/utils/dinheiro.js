// Arredonda para centavos, evitando erros de ponto flutuante
function arredondar(valor) {
  return Math.round((Number(valor) + Number.EPSILON) * 100) / 100;
}

module.exports = { arredondar };
