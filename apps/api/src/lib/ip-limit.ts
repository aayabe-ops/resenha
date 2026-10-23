import type { Database } from '@resenha/db/client';
import { loginIpRequests } from '@resenha/db';
import { and, count, eq, gt, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import type { AppEnv } from './context';
import { hmac } from './crypto';
import { clientIp } from './http';

type Purpose = (typeof loginIpRequests.$inferInsert)['purpose'] & string;

// Limites por IP da spec (seção 3), contados separados por finalidade.
// O IP nunca é guardado em claro: só o HMAC.
export const IP_LIMITS: Record<Purpose, { max: number; windowMinutes: number }> = {
  login_code: { max: 10, windowMinutes: 60 },
  guest: { max: 10, windowMinutes: 60 },
};

export async function hashedClientIp(c: Context<AppEnv>): Promise<string> {
  return hmac(c.env.AUTH_SECRET, `ip:${clientIp(c)}`);
}

export async function ipLimitReached(db: Database, ipHash: string, purpose: Purpose) {
  const { max, windowMinutes } = IP_LIMITS[purpose];
  const [row] = await db
    .select({ total: count() })
    .from(loginIpRequests)
    .where(
      and(
        eq(loginIpRequests.ipHash, ipHash),
        eq(loginIpRequests.purpose, purpose),
        gt(loginIpRequests.createdAt, sql`now() - make_interval(mins => ${windowMinutes})`),
      ),
    );
  return (row?.total ?? 0) >= max;
}

export async function recordIpRequest(db: Database, ipHash: string, purpose: Purpose) {
  await db.insert(loginIpRequests).values({ ipHash, purpose });
}
