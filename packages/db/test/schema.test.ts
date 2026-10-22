// Garante que a migração do Drizzle reproduz exatamente docs/db/schema.sql:
// aplica cada um num banco temporário e compara o catálogo do Postgres.
import { readFile } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const adminUrl = process.env.DATABASE_URL ?? 'postgres://resenha:resenha@localhost:5432/resenha';
const schemaSqlPath = new URL('../../../docs/db/schema.sql', import.meta.url);
const migrationsFolder = new URL('../migrations', import.meta.url).pathname;

const suffix = `${process.pid}_${Date.now()}`;
const referenceDb = `schema_reference_${suffix}`;
const migratedDb = `schema_migrated_${suffix}`;

const catalogQueries = {
  enums: `
    SELECT t.typname AS name, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
    FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typnamespace = 'public'::regnamespace
    GROUP BY t.typname ORDER BY t.typname`,
  columns: `
    SELECT c.relname AS table, a.attnum AS position, a.attname AS column,
           format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS not_null,
           pg_get_expr(d.adbin, d.adrelid) AS default, a.attidentity AS identity,
           a.attgenerated AS generated
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
      AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY c.relname, a.attnum`,
  constraints: `
    SELECT conrelid::regclass::text AS table, conname AS name, contype::text AS type,
           pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace
    ORDER BY 1, 2`,
  indexes: `
    SELECT tablename AS table, indexname AS name, indexdef AS definition
    FROM pg_indexes WHERE schemaname = 'public'
    ORDER BY 1, 2`,
  sequences: `
    SELECT sequencename AS name, data_type::text, start_value, min_value, max_value,
           increment_by, cycle, cache_size
    FROM pg_sequences WHERE schemaname = 'public'
    ORDER BY 1`,
} as const;

async function withClient<T>(database: string, fn: (client: pg.Client) => Promise<T>) {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function readCatalog(database: string) {
  return withClient(database, async (client) => {
    const catalog: Record<string, unknown[]> = {};
    for (const [key, query] of Object.entries(catalogQueries)) {
      catalog[key] = (await client.query(query)).rows;
    }
    return catalog;
  });
}

const admin = new pg.Client({ connectionString: adminUrl });

beforeAll(async () => {
  try {
    await admin.connect();
  } catch (error) {
    throw new Error(
      `Não foi possível conectar ao Postgres em DATABASE_URL. Rode \`pnpm db:up\` antes dos testes.`,
      { cause: error },
    );
  }
  await admin.query(`CREATE DATABASE ${referenceDb}`);
  await admin.query(`CREATE DATABASE ${migratedDb}`);

  const schemaSql = await readFile(schemaSqlPath, 'utf8');
  await withClient(referenceDb, (client) => client.query(schemaSql));
  await withClient(migratedDb, (client) => migrate(drizzle(client), { migrationsFolder }));
});

afterAll(async () => {
  await admin.query(`DROP DATABASE IF EXISTS ${referenceDb}`);
  await admin.query(`DROP DATABASE IF EXISTS ${migratedDb}`);
  await admin.end();
});

describe('migração do Drizzle', () => {
  it('reproduz docs/db/schema.sql', async () => {
    const [reference, migrated] = await Promise.all([
      readCatalog(referenceDb),
      readCatalog(migratedDb),
    ]);

    // Sanidade: a referência tem as 17 tabelas e 13 enums de modelo-de-dados.md
    expect(new Set(reference.columns?.map((row) => (row as { table: string }).table)).size).toBe(
      17,
    );
    expect(reference.enums).toHaveLength(13);

    expect(migrated).toEqual(reference);
  });
});
