/*
  ESLint: pega erros simples antes do merge (variável inexistente,
  código inalcançável, comparação errada...). Roda no CI.

  - Backend (Node.js, CommonJS)
  - Loja e painel (scripts de navegador sem bundler: os arquivos
    compartilham funções globais entre si, por isso no-undef e as
    variáveis de topo não utilizadas ficam desligadas nesses arquivos)

  Fica na raiz para alcançar backend/, frontend/ e admin/. As
  dependências (eslint, @eslint/js, globals) estão em backend/.

  Uso (na pasta backend): npm run lint
*/

const { createRequire } = require('module');
const path = require('path');

// Resolve as dependências a partir de backend/node_modules
const requireBackend = createRequire(path.join(__dirname, 'backend', 'package.json'));

const js = requireBackend('@eslint/js');
const globals = requireBackend('globals');

const regrasComuns = {
  // "_" no início marca algo ignorado de propósito (ex.: { senha: _, ...resto })
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
  'no-empty': ['error', { allowEmptyCatch: true }],
  eqeqeq: ['error', 'always', { null: 'ignore' }]
};

module.exports = [

  { ignores: ['**/node_modules/**', 'assets/**', 'screenshots/**'] },

  js.configs.recommended,

  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: regrasComuns
  },

  {
    files: ['backend/tests/**/*.js'],
    languageOptions: {
      globals: { ...globals.node }
    }
  },

  {
    files: ['frontend/**/*.js', 'admin/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, bootstrap: 'readonly' }
    },
    rules: {
      ...regrasComuns,
      'no-undef': 'off',
      'no-unused-vars': ['error', { vars: 'local', args: 'none', caughtErrors: 'none' }]
    }
  }
];
