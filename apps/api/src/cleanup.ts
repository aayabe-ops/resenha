import { connect } from '@resenha/db/client';
import { loginCodes, loginIpRequests, sessions } from '@resenha/db';
import { and, isNotNull, lt, or, sql } from 'drizzle-orm';
import type { Bindings } from './lib/context';

/**
 * Tarefa agendada (Cron): apaga códigos de login vencidos (mantém os que
 * ainda bloqueiam), sessões vencidas ou revogadas e pedidos por IP com mais
 * de 1 h (retenção em modelo-de-dados.md).
 */
export async function cleanupExpired(env: Pick<Bindings, 'HYPERDRIVE'>): Promise<void> {
  const { db, close } = await connect(env.HYPERDRIVE.connectionString);
  try {
    await db
      .delete(loginCodes)
      .where(
        and(
          lt(loginCodes.expiresAt, sql`now()`),
          or(sql`${loginCodes.lockedUntil} is null`, lt(loginCodes.lockedUntil, sql`now()`)),
        ),
      );
    await db
      .delete(sessions)
      .where(or(lt(sessions.expiresAt, sql`now()`), isNotNull(sessions.revokedAt)));
    await db
      .delete(loginIpRequests)
      .where(lt(loginIpRequests.createdAt, sql`now() - interval '1 hour'`));
  } finally {
    await close();
  }
}
