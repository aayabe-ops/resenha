// Conexão com o Postgres em tempo de execução (ADR 0007): `pg` com
// drizzle-orm/node-postgres. Crie uma conexão por invocação (requisição,
// Cron ou handler de Durable Object) e feche ao final; nunca guarde no
// escopo global nem num campo do Durable Object.
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema> & { $client: pg.Client };

export interface Connection {
  db: Database;
  close: () => Promise<void>;
}

export async function connect(connectionString: string): Promise<Connection> {
  const client = new pg.Client({ connectionString });
  let closing = false;
  // Sem este handler, um erro do socket vira exceção não tratada. Depois do
  // close(), o socket do Workers (pg-cloudflare) ainda emite "socket closed",
  // que é esperado. Nunca registrar a mensagem do erro: pode conter dados.
  client.on('error', (error: Error & { code?: string }) => {
    if (!closing) console.error('postgres client error', error.code ?? error.name);
  });
  await client.connect();
  return {
    db: drizzle(client, { schema }),
    close: async () => {
      closing = true;
      await client.end();
    },
  };
}
