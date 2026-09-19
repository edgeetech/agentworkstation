// @ts-check
const js = require('@eslint/js');
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const reactHooks = require('eslint-plugin-react-hooks');

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'dist-electron/**',
      'coverage/**',
      '*.cjs',
      'eslint.config.js',
    ],
  },
  // JS files
  {
    files: ['**/*.js', '**/*.mjs'],
    ...js.configs.recommended,
  },
  // TypeScript files
  {
    files: ['src/**/*.{ts,tsx}', 'apps/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: null, // avoid requiring tsconfig for linting speed
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        fetch: 'readonly',
        Response: 'readonly',
        URL: 'readonly',
        Map: 'readonly',
        Set: 'readonly',
        Promise: 'readonly',
        JSON: 'readonly',
        console: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'warn',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
