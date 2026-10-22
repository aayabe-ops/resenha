import { createRequire } from 'node:module';
import path from 'node:path';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { testDatabaseUrl } from './test/database-url';

// Os testes usam o banco resenha_test (recriado em test/global-setup.ts) no
// lugar do localConnectionString do wrangler.jsonc.
process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE = testDatabaseUrl;

// Com o Vite 8, o plugin do Vitest resolve os `require` do `pg` com as
// condições de `import` e sem a condição `workerd`: carrega o ESM do
// pg-protocol dentro de CommonJS e a versão vazia do pg-cloudflare. Os
// aliases apontam para os builds CommonJS certos. Só afeta os testes; o
// `wrangler dev` resolve normalmente.
const requireFromPg = createRequire(
  createRequire(createRequire(import.meta.url).resolve('@resenha/db/client')).resolve('pg'),
);
const pgCloudflareDir = path.dirname(requireFromPg.resolve('pg-cloudflare/package.json'));

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: { bindings: { AUTH_SECRET: 'segredo-so-para-testes' } },
    }),
  ],
  resolve: {
    alias: {
      'pg-protocol': requireFromPg.resolve('pg-protocol'),
      'pg-cloudflare': path.join(pgCloudflareDir, 'dist/index.js'),
    },
  },
  test: {
    globalSetup: ['./test/global-setup.ts'],
    // Os arquivos compartilham o banco de testes
    fileParallelism: false,
  },
});
