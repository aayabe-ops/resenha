import { connect, type Connection } from '@resenha/db/client';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from './context';

/**
 * Abre a conexão com o Postgres só se a rota usar o banco e fecha ao fim da
 * requisição. Nunca guarda conexão entre requisições (ADR 0007, condição 2).
 */
export const withDb = createMiddleware<AppEnv>(async (c, next) => {
  let connection: Promise<Connection> | undefined;
  c.set('db', async () => {
    connection ??= connect(c.env.HYPERDRIVE.connectionString);
    return (await connection).db;
  });
  try {
    await next();
  } finally {
    if (connection) {
      await connection.then(
        (open) => open.close(),
        () => undefined,
      );
    }
  }
});
