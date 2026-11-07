import js from '@eslint/js'
import globals from 'globals'

export default [
  { ignores: ['node_modules/', 'coverage/'] },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }]
    }
  },
  {
    // The webapp must parse on Chromium 69 (SPEC 6.2): ES2017 syntax only.
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2017,
      sourceType: 'module',
      globals: { ...globals.browser }
    },
    rules: {
      // Runtime APIs Chromium 69 lacks (signalk-visuals 1); syntax is caught by ecmaVersion.
      'no-restricted-properties': ['error',
        { object: 'Object', property: 'fromEntries' },
        { object: 'Promise', property: 'allSettled' },
        { property: 'at', message: 'Array.prototype.at needs Chromium 92' },
        { property: 'flat' },
        { property: 'flatMap' },
        { property: 'matchAll' },
        { property: 'replaceAll' }],
      'no-restricted-globals': ['error', 'globalThis', 'structuredClone', 'queueMicrotask']
    }
  }
]
