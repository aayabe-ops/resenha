import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    // Padrão: o Postgres do docker-compose.yml (só desenvolvimento local).
    url: process.env.DATABASE_URL ?? 'postgres://resenha:resenha@localhost:5432/resenha',
  },
});
