// Convidado, perfil e exclusão de conta (ACE-01, ACE-05, ACE-06).
import { loginCodes, sessions, users } from '@resenha/db';
import {
  guestBody,
  isMinor,
  isUnderMinAge,
  neutralBirthDate,
  type Me,
  type PublicProfile,
} from '@resenha/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../lib/context';
import { apiError, readBody } from '../lib/http';
import { hashedClientIp, ipLimitReached, recordIpRequest } from '../lib/ip-limit';
import { clearSessionCookie, requireUser, startSession } from '../lib/session';

const DELETED_NICKNAME = 'ex-participante';

export const account = new Hono<AppEnv>();

// Convidado sem login: apelido e nascimento, sem celular (ACE-01). A foto
// depende de onde ficam os arquivos (questão em aberto #4). Limite por IP
// decidido em 22/10/2026 (spec, seção 3).
account.post('/guests', async (c) => {
  const body = await readBody(c, guestBody);
  if (!body) return apiError(c, 400, 'invalid_request');
  if (isUnderMinAge(body.birthDate)) return apiError(c, 403, 'under_age');

  const db = await c.var.db();
  const ipHash = await hashedClientIp(c);
  if (await ipLimitReached(db, ipHash, 'guest')) return apiError(c, 429, 'rate_limited');
  await recordIpRequest(db, ipHash, 'guest');

  const [created] = await db
    .insert(users)
    .values({
      nickname: body.nickname,
      birthDate: body.birthDate,
      consentStatus: isMinor(body.birthDate) ? 'pending' : 'not_required',
    })
    .returning({ id: users.id });
  if (!created) return apiError(c, 500, 'internal');

  await startSession(c, created.id);
  return c.json({ status: 'logged_in' }, 201);
});

account.get('/me', requireUser, (c) => {
  const { user } = c.var;
  return c.json({
    id: user.id,
    nickname: user.nickname,
    photoUrl: user.photoUrl,
    isMinor: isMinor(user.birthDate),
    isGuest: user.phoneE164 === null,
  } satisfies Me);
});

// Exclusão de conta (ACE-06; ver "Exclusão de conta" em modelo-de-dados.md):
// a linha fica para não quebrar o histórico dos amigos, mas os dados pessoais
// são apagados na hora.
account.delete('/me', requireUser, async (c) => {
  const { user } = c.var;
  const db = await c.var.db();
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        nickname: DELETED_NICKNAME,
        photoUrl: null,
        phoneE164: null,
        phoneVerifiedAt: null,
        birthDate: neutralBirthDate(user.birthDate),
        deletedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(users.id, user.id));
    await tx
      .update(sessions)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)));
    if (user.phoneE164) {
      await tx.delete(loginCodes).where(eq(loginCodes.phoneE164, user.phoneE164));
    }
  });
  clearSessionCookie(c);
  return c.body(null, 204);
});

// Perfil visto por outra pessoa: só apelido e foto (ACE-05). Grupos em comum
// entram com a entrega 3. Só por id e com sessão; nada de busca.
account.get('/users/:id', requireUser, async (c) => {
  const id = z.uuid().safeParse(c.req.param('id'));
  if (!id.success) return apiError(c, 404, 'not_found');

  const db = await c.var.db();
  const [profile] = await db
    .select({ id: users.id, nickname: users.nickname, photoUrl: users.photoUrl })
    .from(users)
    .where(eq(users.id, id.data))
    .limit(1);
  if (!profile) return apiError(c, 404, 'not_found');
  return c.json(profile satisfies PublicProfile);
});
