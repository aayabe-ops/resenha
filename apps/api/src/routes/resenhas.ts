// Resenha (RES-01 a RES-07). Criar e listar ficam no Worker; tudo o que muda
// a participação passa pelo Durable Object da resenha, que grava e avisa ao
// vivo. Toda checagem de permissão é feita no servidor.
import { groupMembers, participations, polls, resenhas, users } from '@resenha/db';
import {
  closePollBody,
  createResenhaBody,
  deadlineBody,
  isUnderMinAge,
  joinResenhaBody,
  optionBody,
  rsvpBody,
  suggestionsBody,
  voteBody,
  type ResenhaSummary,
  type ResenhaView,
} from '@resenha/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../lib/context';
import { randomInviteCode } from '../lib/crypto';
import { apiError, clientIp, readBody } from '../lib/http';
import { applyMinorRule, createDefaultOptions, loadPolls } from '../lib/polls';
import { loadParticipants, loadRequests } from '../lib/resenha-state';
import { optionalUser, requirePhone, requireUser } from '../lib/session';
import { verifyTurnstile } from '../lib/turnstile';
import type { ActionResult, Decision } from '../resenha-room';

const uuid = z.uuid();
const inviteCode = z.string().regex(/^[A-Za-z0-9_-]{22}$/);

function room(c: Context<AppEnv>, resenhaId: string) {
  return c.env.RESENHA_ROOM.get(c.env.RESENHA_ROOM.idFromName(resenhaId));
}

function actionResponse(c: Context<AppEnv>, result: ActionResult) {
  switch (result) {
    case 'ok':
      return c.body(null, 204);
    case 'closed':
      return apiError(c, 409, 'resenha_closed');
    case 'poll_closed':
      return apiError(c, 409, 'poll_closed');
    case 'tie':
      return apiError(c, 409, 'tie');
    case 'forbidden':
      return apiError(c, 403, 'forbidden');
    case 'blocked':
      return apiError(c, 422, 'blocked_text');
    case 'invalid':
      return apiError(c, 400, 'invalid_request');
    case 'not_found':
      return apiError(c, 404, 'not_found');
  }
}

async function isApprovedMember(c: Context<AppEnv>, groupId: string, userId: string) {
  const db = await c.var.db();
  const [row] = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.userId, userId),
        eq(groupMembers.status, 'approved'),
      ),
    );
  return Boolean(row);
}

export const resenhaRoutes = new Hono<AppEnv>();

// RES-01: qualquer membro aprovado cria; vira organizador. Abre o registro
// das votações escolhidas (opções e votos na entrega 5). Turnstile na
// criação de resenha (spec, seção 1).
resenhaRoutes.post('/groups/:id/resenhas', requireUser, requirePhone, async (c) => {
  const groupId = uuid.safeParse(c.req.param('id'));
  if (!groupId.success) return apiError(c, 404, 'not_found');
  const body = await readBody(c, createResenhaBody);
  if (!body) return apiError(c, 400, 'invalid_request');

  const { user } = c.var;
  if (!(await isApprovedMember(c, groupId.data, user.id))) return apiError(c, 404, 'not_found');
  if (!(await verifyTurnstile(c.env, body.turnstileToken, clientIp(c)))) {
    return apiError(c, 403, 'turnstile_failed');
  }

  const db = await c.var.db();
  const created = await db.transaction(async (tx) => {
    const [resenha] = await tx
      .insert(resenhas)
      .values({
        groupId: groupId.data,
        organizerId: user.id,
        name: body.name ?? null,
        date: body.date,
        inviteCode: randomInviteCode(),
      })
      .returning({ id: resenhas.id, inviteCode: resenhas.inviteCode });
    if (!resenha) throw new Error('resenha não criada');
    await tx.insert(participations).values({
      resenhaId: resenha.id,
      userId: user.id,
      access: 'approved',
      inviteSource: 'group_link',
      decidedBy: user.id,
    });
    const kinds = [...new Set(body.polls)];
    if (kinds.length > 0) {
      const created = await tx
        .insert(polls)
        .values(kinds.map((kind) => ({ resenhaId: resenha.id, kind })))
        .returning({ id: polls.id, kind: polls.kind });
      for (const poll of created) await createDefaultOptions(tx, poll.id, poll.kind);
      // Organizador menor: "só bebida" já nasce "cada um com o seu" (VOT-02)
      await applyMinorRule(tx, resenha.id);
    }
    return resenha;
  });
  return c.json(created, 201);
});

// Resenhas ativas do grupo (as encerradas ficam no histórico, GRP-04).
resenhaRoutes.get('/groups/:id/resenhas', requireUser, requirePhone, async (c) => {
  const groupId = uuid.safeParse(c.req.param('id'));
  if (!groupId.success) return apiError(c, 404, 'not_found');
  if (!(await isApprovedMember(c, groupId.data, c.var.user.id))) {
    return apiError(c, 404, 'not_found');
  }
  const db = await c.var.db();
  const rows = await db
    .select({
      id: resenhas.id,
      name: resenhas.name,
      date: resenhas.date,
      status: resenhas.status,
      inviteCode: resenhas.inviteCode,
    })
    .from(resenhas)
    .where(and(eq(resenhas.groupId, groupId.data), inArray(resenhas.status, ['open', 'decided'])))
    .orderBy(asc(resenhas.date), asc(resenhas.createdAt));
  return c.json(rows satisfies ResenhaSummary[]);
});

// Página da resenha pelo link. Sem acesso aprovado: só nome, dia, bairro e
// contagem (LOC-01, RES-05). O endereço exato nunca sai daqui (entrega 6).
resenhaRoutes.get('/resenhas/code/:code', optionalUser, async (c) => {
  const code = inviteCode.safeParse(c.req.param('code'));
  if (!code.success) return apiError(c, 404, 'not_found');
  const db = await c.var.db();
  const [resenha] = await db
    .select({
      id: resenhas.id,
      groupId: resenhas.groupId,
      name: resenhas.name,
      date: resenhas.date,
      neighborhood: resenhas.neighborhood,
      status: resenhas.status,
      organizerId: resenhas.organizerId,
      organizerNickname: users.nickname,
      allowSuggestions: resenhas.allowSuggestions,
      startsAt: resenhas.startsAt,
      splitModel: resenhas.splitModel,
    })
    .from(resenhas)
    .innerJoin(users, eq(users.id, resenhas.organizerId))
    .where(eq(resenhas.inviteCode, code.data));
  if (!resenha) return apiError(c, 404, 'not_found');

  const { viewer } = c.var;
  let me: ResenhaView['me'] = null;
  if (viewer) {
    const [participation] = await db
      .select({ access: participations.access, rsvp: participations.rsvp })
      .from(participations)
      .where(and(eq(participations.resenhaId, resenha.id), eq(participations.userId, viewer.id)));
    me = {
      id: viewer.id,
      access: participation?.access ?? null,
      rsvp: participation?.rsvp ?? null,
      isOrganizer: viewer.id === resenha.organizerId,
      isGroupMember: await isApprovedMember(c, resenha.groupId, viewer.id),
    };
  }

  const approved = me?.access === 'approved';
  const { participants, counts } = await loadParticipants(db, resenha.id);
  const pollList = approved ? await loadPolls(db, resenha.id) : [];

  return c.json({
    id: resenha.id,
    groupId: resenha.groupId,
    name: resenha.name,
    date: resenha.date,
    neighborhood: resenha.neighborhood,
    status: resenha.status,
    organizer: { id: resenha.organizerId, nickname: resenha.organizerNickname },
    counts,
    participants: approved ? participants : [],
    requests: me?.isOrganizer ? await loadRequests(db, resenha.id) : [],
    polls: pollList,
    allowSuggestions: resenha.allowSuggestions,
    startsAt: resenha.startsAt?.toISOString() ?? null,
    splitModel: resenha.splitModel,
    me,
  } satisfies ResenhaView);
});

// Entrar pelo link (ACE-01, RES-05). Vale também para convidado sem celular.
resenhaRoutes.post('/resenhas/code/:code/join', requireUser, async (c) => {
  const code = inviteCode.safeParse(c.req.param('code'));
  if (!code.success) return apiError(c, 404, 'not_found');
  const body = (await readBody(c, joinResenhaBody)) ?? { from: null };
  const { user } = c.var;
  // Defesa extra: ninguém abaixo de 15 anos tem conta, mas a regra é absoluta
  if (isUnderMinAge(user.birthDate)) return apiError(c, 403, 'under_age');

  const db = await c.var.db();
  const [resenha] = await db
    .select({ id: resenhas.id })
    .from(resenhas)
    .where(eq(resenhas.inviteCode, code.data));
  if (!resenha) return apiError(c, 404, 'not_found');

  const result = await room(c, resenha.id).join(resenha.id, user.id, body.from ?? null);
  if (result === 'not_found') return apiError(c, 404, 'not_found');
  if (result === 'closed') return apiError(c, 409, 'resenha_closed');
  if (result === 'forbidden') return apiError(c, 403, 'forbidden');
  return c.json({ access: result });
});

resenhaRoutes.post('/resenhas/:id/rsvp', requireUser, async (c) => {
  const id = uuid.safeParse(c.req.param('id'));
  if (!id.success) return apiError(c, 404, 'not_found');
  const body = await readBody(c, rsvpBody);
  if (!body) return apiError(c, 400, 'invalid_request');
  const result = await room(c, id.data).setRsvp(id.data, c.var.user.id, body.rsvp);
  return actionResponse(c, result);
});

const decisions = { approve: 'approve', reject: 'reject', remove: 'remove' } as const;

resenhaRoutes.post('/resenhas/:id/participants/:userId/:decision', requireUser, async (c) => {
  const id = uuid.safeParse(c.req.param('id'));
  const target = uuid.safeParse(c.req.param('userId'));
  const decision = decisions[c.req.param('decision') as Decision] as Decision | undefined;
  if (!id.success || !target.success || !decision) return apiError(c, 404, 'not_found');
  const result = await room(c, id.data).decide(id.data, c.var.user.id, target.data, decision);
  return actionResponse(c, result);
});

resenhaRoutes.post('/resenhas/:id/close', requireUser, async (c) => {
  const id = uuid.safeParse(c.req.param('id'));
  if (!id.success) return apiError(c, 404, 'not_found');
  return actionResponse(c, await room(c, id.data).close(id.data, c.var.user.id));
});

// Ao vivo (RES-03, RES-04): só participante aprovado conecta.
resenhaRoutes.get('/resenhas/:id/live', requireUser, async (c) => {
  const id = uuid.safeParse(c.req.param('id'));
  if (!id.success) return apiError(c, 404, 'not_found');
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
    return apiError(c, 400, 'invalid_request');
  }
  const db = await c.var.db();
  const [row] = await db
    .select({ organizerId: resenhas.organizerId })
    .from(participations)
    .innerJoin(resenhas, eq(resenhas.id, participations.resenhaId))
    .where(
      and(
        eq(participations.resenhaId, id.data),
        eq(participations.userId, c.var.user.id),
        eq(participations.access, 'approved'),
      ),
    );
  if (!row) return apiError(c, 404, 'not_found');

  const headers = new Headers(c.req.raw.headers);
  headers.set('X-Resenha-User', c.var.user.id);
  headers.set('X-Resenha-Id', id.data);
  headers.set('X-Resenha-Role', row.organizerId === c.var.user.id ? 'organizer' : 'participant');
  return room(c, id.data).fetch(new Request(c.req.raw, { headers }));
});

// Votações (VOT-03 a VOT-05). Tudo passa pelo Durable Object da resenha.
const pollParams = (c: Context<AppEnv>) => {
  const id = uuid.safeParse(c.req.param('id'));
  const pollId = uuid.safeParse(c.req.param('pollId'));
  return id.success && pollId.success ? { id: id.data, pollId: pollId.data } : null;
};

resenhaRoutes.post('/resenhas/:id/polls/:pollId/options', requireUser, async (c) => {
  const params = pollParams(c);
  if (!params) return apiError(c, 404, 'not_found');
  const body = await readBody(c, optionBody);
  if (!body) return apiError(c, 400, 'invalid_request');
  const result = await room(c, params.id).addOption(
    params.id,
    c.var.user.id,
    params.pollId,
    body.label,
  );
  return actionResponse(c, result);
});

resenhaRoutes.post('/resenhas/:id/polls/:pollId/vote', requireUser, async (c) => {
  const params = pollParams(c);
  if (!params) return apiError(c, 404, 'not_found');
  const body = await readBody(c, voteBody);
  if (!body) return apiError(c, 400, 'invalid_request');
  const result = await room(c, params.id).vote(
    params.id,
    c.var.user.id,
    params.pollId,
    body.optionId,
  );
  return actionResponse(c, result);
});

resenhaRoutes.post('/resenhas/:id/polls/:pollId/close', requireUser, async (c) => {
  const params = pollParams(c);
  if (!params) return apiError(c, 404, 'not_found');
  const body = (await readBody(c, closePollBody)) ?? { optionId: null };
  const result = await room(c, params.id).closePoll(
    params.id,
    c.var.user.id,
    params.pollId,
    body.optionId ?? null,
  );
  return actionResponse(c, result);
});

resenhaRoutes.post('/resenhas/:id/polls/:pollId/deadline', requireUser, async (c) => {
  const params = pollParams(c);
  if (!params) return apiError(c, 404, 'not_found');
  const body = await readBody(c, deadlineBody);
  if (!body) return apiError(c, 400, 'invalid_request');
  const result = await room(c, params.id).setDeadline(
    params.id,
    c.var.user.id,
    params.pollId,
    body.closesAt,
  );
  return actionResponse(c, result);
});

resenhaRoutes.post('/resenhas/:id/suggestions', requireUser, async (c) => {
  const id = uuid.safeParse(c.req.param('id'));
  if (!id.success) return apiError(c, 404, 'not_found');
  const body = await readBody(c, suggestionsBody);
  if (!body) return apiError(c, 400, 'invalid_request');
  const result = await room(c, id.data).setAllowSuggestions(id.data, c.var.user.id, body.allow);
  return actionResponse(c, result);
});
