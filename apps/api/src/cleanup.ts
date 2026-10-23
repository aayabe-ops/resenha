import { connect } from '@resenha/db/client';
import { loginCodes, loginIpRequests, resenhas, sessions } from '@resenha/db';
import { and, isNotNull, lt, or, sql } from 'drizzle-orm';
import type { Bindings } from './lib/context';

/**
 * Tarefa agendada (Cron): apaga códigos de login vencidos (mantém os que
 * ainda bloqueiam), sessões vencidas ou revogadas, pedidos por IP com mais
 * de 1 h e o endereço exato 24 h depois do encerramento (LOC-03; retenção em
 * modelo-de-dados.md).
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
    await db
      .update(resenhas)
      .set({ exactAddress: null, addressPurgedAt: sql`now()` })
      .where(
        and(
          isNotNull(resenhas.exactAddress),
          lt(resenhas.closedAt, sql`now() - interval '24 hours'`),
        ),
      );
  } finally {
    await close();
  }
}
