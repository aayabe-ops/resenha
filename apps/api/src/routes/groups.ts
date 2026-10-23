// Grupos (GRP-01 a GRP-04). Entrar só por link; nenhuma rota lista ou busca
// grupos dos outros. Toda checagem de permissão é feita aqui.
import type { Database } from '@resenha/db/client';
import { groupMembers, groups, resenhas, users } from '@resenha/db';
import {
  createGroupBody,
  type GroupDetail,
  type GroupHistoryItem,
  type GroupSummary,
  type InviteInfo,
} from '@resenha/shared';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../lib/context';
import { randomInviteCode } from '../lib/crypto';
import { apiError, readBody } from '../lib/http';
import { requirePhone, requireUser } from '../lib/session';

/** RNF-06: grupos de até 200 membros. */
export const MAX_GROUP_MEMBERS = 200;

const uuid = z.uuid();
const inviteCode = z.string().regex(/^[A-Za-z0-9_-]{22}$/);

type Queryable = Pick<Database, 'select'>;

async function membershipOf(db: Queryable, groupId: string, userId: string) {
  const [row] = await db
    .select({ role: groupMembers.role, status: groupMembers.status })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);
  return row ?? null;
}

export const groupRoutes = new Hono<AppEnv>();
// Em cada rota (e não com use()), para não afetar as outras rotas da API
const signedIn = [requireUser, requirePhone] as const;

// GRP-01: cria o grupo com link único; quem cria vira admin.
groupRoutes.post('/groups', ...signedIn, async (c) => {
  const body = await readBody(c, createGroupBody);
  if (!body) return apiError(c, 400, 'invalid_request');

  const { user } = c.var;
  const db = await c.var.db();
  const created = await db.transaction(async (tx) => {
    const [group] = await tx
      .insert(groups)
      .values({ name: body.name, inviteCode: randomInviteCode(), createdBy: user.id })
      .returning({ id: groups.id, name: groups.name, inviteCode: groups.inviteCode });
    if (!group) throw new Error('grupo não criado');
    await tx.insert(groupMembers).values({
      groupId: group.id,
      userId: user.id,
      role: 'admin',
      status: 'approved',
      approvedBy: user.id,
    });
    return group;
  });
  return c.json(created, 201);
});

// "Meus grupos": só os grupos em que a pessoa é membro aprovada.
groupRoutes.get('/groups', ...signedIn, async (c) => {
  const db = await c.var.db();
  const rows = await db
    .select({
      id: groups.id,
      name: groups.name,
      photoUrl: groups.photoUrl,
      role: groupMembers.role,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(and(eq(groupMembers.userId, c.var.user.id), eq(groupMembers.status, 'approved')))
    .orderBy(asc(groups.name));
  return c.json(rows satisfies GroupSummary[]);
});

// Página do grupo, só para membros aprovados. Para quem não é membro, o
// grupo "não existe" (404), para não confirmar que o id é válido.
groupRoutes.get('/groups/:id', ...signedIn, async (c) => {
  const id = uuid.safeParse(c.req.param('id'));
  if (!id.success) return apiError(c, 404, 'not_found');
  const db = await c.var.db();
  const me = await membershipOf(db, id.data, c.var.user.id);
  if (me?.status !== 'approved') return apiError(c, 404, 'not_found');

  const [group] = await db
    .select({
      id: groups.id,
      name: groups.name,
      photoUrl: groups.photoUrl,
      inviteCode: groups.inviteCode,
    })
    .from(groups)
    .where(eq(groups.id, id.data));
  if (!group) return apiError(c, 404, 'not_found');

  const people = await db
    .select({
      id: users.id,
      nickname: users.nickname,
      photoUrl: users.photoUrl,
      role: groupMembers.role,
      status: groupMembers.status,
    })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(eq(groupMembers.groupId, id.data))
    .orderBy(asc(groupMembers.createdAt));

  return c.json({
    ...group,
    role: me.role,
    members: people
      .filter((person) => person.status === 'approved')
      .map(({ id: personId, nickname, photoUrl, role }) => ({
        id: personId,
        nickname,
        photoUrl,
        role,
      })),
    pending:
      me.role === 'admin'
        ? people
            .filter((person) => person.status === 'pending')
            .map(({ id: personId, nickname, photoUrl }) => ({ id: personId, nickname, photoUrl }))
        : [],
  } satisfies GroupDetail);
});

// GRP-04: resenhas encerradas, da mais nova para a mais antiga.
groupRoutes.get('/groups/:id/history', ...signedIn, async (c) => {
  const id = uuid.safeParse(c.req.param('id'));
  if (!id.success) return apiError(c, 404, 'not_found');
  const db = await c.var.db();
  const me = await membershipOf(db, id.data, c.var.user.id);
  if (me?.status !== 'approved') return apiError(c, 404, 'not_found');

  const rows = await db
    .select({
      id: resenhas.id,
      name: resenhas.name,
      date: resenhas.date,
      neighborhood: resenhas.neighborhood,
    })
    .from(resenhas)
    .where(and(eq(resenhas.groupId, id.data), eq(resenhas.status, 'closed')))
    .orderBy(desc(resenhas.date), desc(resenhas.createdAt));
  return c.json(rows satisfies GroupHistoryItem[]);
});

// GRP-03: quem abre o link vê só o nome do grupo e a própria situação.
groupRoutes.get('/invites/:code', ...signedIn, async (c) => {
  const code = inviteCode.safeParse(c.req.param('code'));
  if (!code.success) return apiError(c, 404, 'not_found');
  const db = await c.var.db();
  const [group] = await db
    .select({ id: groups.id, name: groups.name })
    .from(groups)
    .where(eq(groups.inviteCode, code.data));
  if (!group) return apiError(c, 404, 'not_found');

  const me = await membershipOf(db, group.id, c.var.user.id);
  return c.json({
    groupId: group.id,
    name: group.name,
    status: me?.status ?? null,
  } satisfies InviteInfo);
});

// GRP-03: pedido de entrada pelo link; fica pendente até um admin aprovar.
groupRoutes.post('/invites/:code/join', ...signedIn, async (c) => {
  const code = inviteCode.safeParse(c.req.param('code'));
  if (!code.success) return apiError(c, 404, 'not_found');
  const db = await c.var.db();
  const [group] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.inviteCode, code.data));
  if (!group) return apiError(c, 404, 'not_found');

  const me = await membershipOf(db, group.id, c.var.user.id);
  // Recusado ou removido não pede de novo pelo link (spec, seção 3)
  if (me?.status === 'removed') return apiError(c, 403, 'forbidden');
  if (me) return c.json({ status: me.status });

  await db
    .insert(groupMembers)
    .values({ groupId: group.id, userId: c.var.user.id })
    .onConflictDoNothing();
  return c.json({ status: 'pending' }, 201);
});

async function requireAdmin(db: Queryable, groupId: string, userId: string) {
  const me = await membershipOf(db, groupId, userId);
  return me?.status === 'approved' && me.role === 'admin';
}

const memberParams = (groupId: string, userId: string) => {
  const group = uuid.safeParse(groupId);
  const user = uuid.safeParse(userId);
  return group.success && user.success ? { groupId: group.data, userId: user.data } : null;
};

// GRP-03: o admin aprova um pedido pendente.
groupRoutes.post('/groups/:id/members/:userId/approve', ...signedIn, async (c) => {
  const params = memberParams(c.req.param('id'), c.req.param('userId'));
  if (!params) return apiError(c, 404, 'not_found');
  const admin = c.var.user;
  const db = await c.var.db();
  if (!(await requireAdmin(db, params.groupId, admin.id))) return apiError(c, 404, 'not_found');

  const result = await db.transaction(async (tx) => {
    // Trava o grupo para a contagem do limite de membros não correr
    await tx.execute(
      sql`select 1 from ${groups} where ${groups.id} = ${params.groupId} for update`,
    );
    const target = await membershipOf(tx, params.groupId, params.userId);
    if (target?.status !== 'pending') return 'not_found' as const;

    const [approved] = await tx
      .select({ total: count() })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, params.groupId), eq(groupMembers.status, 'approved')));
    if ((approved?.total ?? 0) >= MAX_GROUP_MEMBERS) return 'group_full' as const;

    await tx
      .update(groupMembers)
      .set({ status: 'approved', approvedBy: admin.id, updatedAt: sql`now()` })
      .where(and(eq(groupMembers.groupId, params.groupId), eq(groupMembers.userId, params.userId)));
    return 'approved' as const;
  });

  if (result === 'not_found') return apiError(c, 404, 'not_found');
  if (result === 'group_full') return apiError(c, 409, 'group_full');
  return c.body(null, 204);
});

// GRP-03: o admin recusa um pedido ou remove um membro, a qualquer momento.
// Sem aviso público (requisitos, seção 9.2).
groupRoutes.post('/groups/:id/members/:userId/remove', ...signedIn, async (c) => {
  const params = memberParams(c.req.param('id'), c.req.param('userId'));
  if (!params) return apiError(c, 404, 'not_found');
  const db = await c.var.db();
  if (!(await requireAdmin(db, params.groupId, c.var.user.id))) {
    return apiError(c, 404, 'not_found');
  }

  const target = await membershipOf(db, params.groupId, params.userId);
  if (!target || target.status === 'removed') return apiError(c, 404, 'not_found');
  if (target.role === 'admin') return apiError(c, 403, 'forbidden');

  await db
    .update(groupMembers)
    .set({ status: 'removed', updatedAt: sql`now()` })
    .where(and(eq(groupMembers.groupId, params.groupId), eq(groupMembers.userId, params.userId)));
  return c.body(null, 204);
});
