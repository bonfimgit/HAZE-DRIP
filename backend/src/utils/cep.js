/*
  Estado (UF) a partir do CEP, pelas faixas oficiais dos Correios.
  Usado na cotação quando só o CEP é informado (ex.: "Calcular frete"
  na sacola), para que as regras de frete por estado funcionem sem
  depender de um serviço externo.
*/

// [início, fim, UF] — 5 primeiros dígitos do CEP
const FAIXAS = [
  [1000, 19999, 'SP'],
  [20000, 28999, 'RJ'],
  [29000, 29999, 'ES'],
  [30000, 39999, 'MG'],
  [40000, 48999, 'BA'],
  [49000, 49999, 'SE'],
  [50000, 56999, 'PE'],
  [57000, 57999, 'AL'],
  [58000, 58999, 'PB'],
  [59000, 59999, 'RN'],
  [60000, 63999, 'CE'],
  [64000, 64999, 'PI'],
  [65000, 65999, 'MA'],
  [66000, 68899, 'PA'],
  [68900, 68999, 'AP'],
  [69000, 69299, 'AM'],
  [69300, 69399, 'RR'],
  [69400, 69899, 'AM'],
  [69900, 69999, 'AC'],
  [70000, 72799, 'DF'],
  [72800, 72999, 'GO'],
  [73000, 73699, 'DF'],
  [73700, 76799, 'GO'],
  [76800, 76999, 'RO'],
  [77000, 77999, 'TO'],
  [78000, 78899, 'MT'],
  [79000, 79999, 'MS'],
  [80000, 87999, 'PR'],
  [88000, 89999, 'SC'],
  [90000, 99999, 'RS']
];

function ufPorCep(cep) {

  const digitos = String(cep || '').replace(/\D/g, '');

  if (digitos.length !== 8) {
    return null;
  }

  const prefixo = Number(digitos.slice(0, 5));
  const faixa = FAIXAS.find(([inicio, fim]) => prefixo >= inicio && prefixo <= fim);

  return faixa ? faixa[2] : null;
}

module.exports = { ufPorCep };
