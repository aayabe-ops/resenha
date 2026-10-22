import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.wrangler/**', '**/coverage/**', '**/worker-configuration.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  prettier,
);
