import { sessions, users } from '@resenha/db';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { AppEnv, SessionUser } from './context';
import { randomToken, sha256 } from './crypto';
import { apiError } from './http';

// Sessão de 30 dias, renovada com o uso (spec, seção 3). Cookie httpOnly,
// Secure e SameSite=Lax; no banco, só o hash do token (ADR 0003).
export const SESSION_COOKIE = '__Host-resenha_session';
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
// Renova no máximo uma vez por dia, para não gravar a cada requisição
const RENEW_WHEN_LEFT_MS = SESSION_MS - 24 * 60 * 60 * 1000;

function writeCookie(c: Context, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
}

export async function startSession(c: Context<AppEnv>, userId: string): Promise<void> {
  const token = randomToken();
  const db = await c.var.db();
  await db.insert(sessions).values({
    userId,
    tokenHash: await sha256(token),
    expiresAt: sql`now() + make_interval(days => ${SESSION_DAYS})`,
  });
  writeCookie(c, token);
}

/**
 * Usuário da sessão, ou null. A consulta usa now(), então nunca vem do cache
 * do Hyperdrive (ADR 0007, condição 5). Renova a sessão com o uso.
 */
async function sessionUser(c: Context<AppEnv>): Promise<SessionUser | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;

  const db = await c.var.db();
  const [row] = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      id: users.id,
      nickname: users.nickname,
      photoUrl: users.photoUrl,
      phoneE164: users.phoneE164,
      birthDate: users.birthDate,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, await sha256(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, sql`now()`),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);

  if (!row) {
    clearSessionCookie(c);
    return null;
  }

  if (row.expiresAt.getTime() - Date.now() < RENEW_WHEN_LEFT_MS) {
    await db
      .update(sessions)
      .set({ expiresAt: sql`now() + make_interval(days => ${SESSION_DAYS})` })
      .where(eq(sessions.id, row.sessionId));
    writeCookie(c, token);
  }

  return {
    id: row.id,
    sessionId: row.sessionId,
    nickname: row.nickname,
    photoUrl: row.photoUrl,
    phoneE164: row.phoneE164,
    birthDate: row.birthDate,
  };
}

/** Exige sessão válida e usuário ativo. */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const user = await sessionUser(c);
  if (!user) return apiError(c, 401, 'unauthorized');
  c.set('user', user);
  await next();
});

/** Carrega o usuário se houver sessão, sem exigir (páginas abertas por link). */
export const optionalUser = createMiddleware<AppEnv>(async (c, next) => {
  c.set('viewer', await sessionUser(c));
  await next();
});

/** Exige conta com celular: grupos não aceitam convidado (spec, seção 3). */
export const requirePhone = createMiddleware<AppEnv>(async (c, next) => {
  if (c.var.user.phoneE164 === null) return apiError(c, 403, 'phone_required');
  await next();
});
