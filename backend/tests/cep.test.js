const { test } = require('node:test');
const assert = require('node:assert/strict');

const { ufPorCep } = require('../src/utils/cep');

test('estado pela faixa do CEP', () => {

  const casos = {
    '01310-100': 'SP', '19999-999': 'SP',
    '20040-020': 'RJ', '29010-000': 'ES',
    '30130-010': 'MG', '37900-000': 'MG',
    '40010-000': 'BA', '69005-040': 'AM', '69301-000': 'RR',
    '70040-010': 'DF', '73700-000': 'GO', '74000-000': 'GO',
    '76801-000': 'RO', '80010-000': 'PR', '88010-000': 'SC',
    '90010-150': 'RS', '99999-999': 'RS'
  };

  for (const [cep, uf] of Object.entries(casos)) {
    assert.equal(ufPorCep(cep), uf, cep);
  }

  for (const invalido of ['', null, '123', '00000-000', '00999-999', 'abcdefgh']) {
    assert.equal(ufPorCep(invalido), null, String(invalido));
  }
});
