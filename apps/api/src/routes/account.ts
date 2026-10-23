// Convidado, perfil e exclusão de conta (ACE-01, ACE-05, ACE-06).
import { groupMembers, groups, loginCodes, sessions, users } from '@resenha/db';
import {
  guestBody,
  isMinor,
  isUnderMinAge,
  neutralBirthDate,
  type Me,
  type PublicProfile,
} from '@resenha/shared';
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
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

    // Se era o único admin de um grupo, a administração passa ao membro
    // aprovado mais antigo; depois a pessoa sai de todos os grupos.
    const adminOf = await tx
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.userId, user.id),
          eq(groupMembers.role, 'admin'),
          eq(groupMembers.status, 'approved'),
        ),
      );
    for (const { groupId } of adminOf) {
      const others = await tx
        .select({ userId: groupMembers.userId, role: groupMembers.role })
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupId, groupId),
            eq(groupMembers.status, 'approved'),
            ne(groupMembers.userId, user.id),
          ),
        )
        .orderBy(asc(groupMembers.createdAt));
      const successor = others.some((other) => other.role === 'admin') ? null : others[0];
      if (successor) {
        await tx
          .update(groupMembers)
          .set({ role: 'admin', updatedAt: sql`now()` })
          .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, successor.userId)));
      }
    }
    await tx
      .update(groupMembers)
      .set({ status: 'removed', role: 'member', updatedAt: sql`now()` })
      .where(eq(groupMembers.userId, user.id));
  });
  clearSessionCookie(c);
  return c.body(null, 204);
});

// Perfil visto por outra pessoa: só apelido, foto e grupos em comum (ACE-05).
// Só por id e com sessão; nada de busca.
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

  const theirs = alias(groupMembers, 'theirs');
  const commonGroups = await db
    .select({ id: groups.id, name: groups.name })
    .from(groupMembers)
    .innerJoin(theirs, eq(theirs.groupId, groupMembers.groupId))
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(
      and(
        eq(groupMembers.userId, c.var.user.id),
        eq(groupMembers.status, 'approved'),
        eq(theirs.userId, profile.id),
        eq(theirs.status, 'approved'),
      ),
    )
    .orderBy(asc(groups.name));
  return c.json({ ...profile, commonGroups } satisfies PublicProfile);
});
