import js from '@eslint/js'
import globals from 'globals'

export default [
  { ignores: ['node_modules/', 'coverage/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  {
    // The webapp must parse on Chromium 69 (SPEC 6.2): ES2017 syntax only.
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2017,
      sourceType: 'module',
      globals: { ...globals.browser }
    }
  }
]
