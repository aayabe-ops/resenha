// Utilitários de teste que rodam em Node (fora do Worker): recriam um banco
// e aplicam as migrações do Drizzle.
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export const LOCAL_DATABASE_URL = 'postgres://resenha:resenha@localhost:5432/resenha';

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url).href);

/** Mesma URL de `adminUrl`, apontando para outro banco. */
export function databaseUrl(adminUrl: string, database: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

/** Apaga e recria `database` e aplica todas as migrações. */
export async function resetDatabase(adminUrl: string, database: string): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/.test(database)) throw new Error('Nome de banco inválido');
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${database}`);
  } finally {
    await admin.end();
  }
  const client = new pg.Client({ connectionString: databaseUrl(adminUrl, database) });
  await client.connect();
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}
