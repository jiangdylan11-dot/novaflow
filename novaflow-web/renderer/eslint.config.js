import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'assets/**',
      'public/**',
      'vendor/**',
      'debug-assets/**',
      'aifx-v3/**',
      '*.js',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}', '*.config.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {},
  }
);
