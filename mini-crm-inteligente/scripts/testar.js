// Executa todos os tests/*.test.js com o runner nativo do Node. Funciona em Windows, Linux e macOS.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const pasta = path.join(__dirname, '..', 'tests');
const arquivos = fs.readdirSync(pasta).filter((nome) => nome.endsWith('.test.js')).sort().map((nome) => path.join(pasta, nome));

const resultado = spawnSync(process.execPath, ['--test', ...arquivos], { stdio: 'inherit' });
process.exit(resultado.status ?? 1);
