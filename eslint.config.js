// @ts-check
const js = require('@eslint/js');

module.exports = [
  {
    ignores: ['node_modules/', 'dist/', 'dist-electron/', 'coverage/', '*.cjs', '**/*.ts', '**/*.tsx', 'eslint.config.js'],
  },
  js.configs.recommended,
  {
    rules: {
      'no-unused-vars': 'warn',
      'no-console': 'warn',
    },
    languageOptions: {
      globals: {
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        NodeJS: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        fetch: 'readonly',
        Response: 'readonly',
        URL: 'readonly',
      },
    },
  },
];
