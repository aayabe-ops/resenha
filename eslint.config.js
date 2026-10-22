import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.wrangler/**', '**/coverage/**', '**/worker-configuration.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat.recommended,
  },
  {
    files: ['apps/web/public/sw.js'],
    languageOptions: { globals: { self: 'readonly' } },
  },
  prettier,
);
