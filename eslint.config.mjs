// Minimal lint setup used by `npm run lint` (no plugins required).
const nodeGlobals = { process: 'readonly', console: 'readonly', setTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', clearTimeout: 'readonly', performance: 'readonly', URL: 'readonly', Buffer: 'readonly', fetch: 'readonly' };
const browserGlobals = {
  window: 'readonly', document: 'readonly', localStorage: 'readonly', sessionStorage: 'readonly', navigator: 'readonly', location: 'readonly', history: 'readonly',
  performance: 'readonly', requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly',
  clearInterval: 'readonly', WebSocket: 'readonly', URLSearchParams: 'readonly', AudioContext: 'readonly', console: 'readonly', HTMLElement: 'readonly', KeyboardEvent: 'readonly',
};
const rules = {
  'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none' }],
  'no-undef': 'error', 'no-unreachable': 'error', 'no-dupe-keys': 'error', 'no-redeclare': 'error', 'no-self-assign': 'error', 'no-const-assign': 'error',
  'no-constant-condition': ['warn', { checkLoops: false }], 'no-empty': ['warn', { allowEmptyCatch: true }], 'eqeqeq': ['warn', 'smart'], 'no-shadow-restricted-names': 'error',
};
export default [
  { files: ['src/server/**/*.js', 'src/shared/**/*.js', 'tools/**/*.js'], languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: nodeGlobals }, rules },
  { files: ['tools/**/*.mjs'], languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...nodeGlobals, ...browserGlobals } }, rules },
  { files: ['src/client/**/*.js'], languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: browserGlobals }, rules },
  { ignores: ['node_modules/**'] },
];
