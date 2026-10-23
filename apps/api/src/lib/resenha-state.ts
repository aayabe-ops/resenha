// Leituras do estado de uma resenha, usadas pela página (Worker) e pelo
// Durable Object ao avisar as mudanças. A fonte da verdade é o Postgres.
import type { Database } from '@resenha/db/client';
import { groupMembers, items, participations, resenhas, users } from '@resenha/db';
import type {
  ResenhaCounts,
  ResenhaItem,
  ResenhaLive,
  ResenhaParticipant,
  ResenhaRequest,
  ResenhaStatus,
} from '@resenha/shared';
import { loadPolls } from './polls';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

type Queryable = Pick<Database, 'select' | 'selectDistinct'>;

export async function loadParticipants(
  db: Queryable,
  resenhaId: string,
): Promise<{ participants: ResenhaParticipant[]; counts: ResenhaCounts }> {
  const participants = await db
    .select({
      id: users.id,
      nickname: users.nickname,
      photoUrl: users.photoUrl,
      rsvp: participations.rsvp,
      isOrganizer: sql<boolean>`${users.id} = ${resenhas.organizerId}`,
    })
    .from(participations)
    .innerJoin(users, eq(users.id, participations.userId))
    .innerJoin(resenhas, eq(resenhas.id, participations.resenhaId))
    .where(and(eq(participations.resenhaId, resenhaId), eq(participations.access, 'approved')))
    .orderBy(asc(participations.createdAt));

  const counts = { going: 0, maybe: 0, notGoing: 0 };
  for (const person of participants) {
    if (person.rsvp === 'going') counts.going += 1;
    else if (person.rsvp === 'maybe') counts.maybe += 1;
    else if (person.rsvp === 'not_going') counts.notGoing += 1;
  }
  return { participants, counts };
}

/**
 * Amigos em comum (RES-05): participantes aprovados desta resenha que estão
 * em algum grupo junto com quem pediu para entrar.
 */
async function commonFriends(db: Queryable, resenhaId: string, userId: string) {
  const theirs = alias(groupMembers, 'theirs');
  return db
    .selectDistinct({ id: users.id, nickname: users.nickname })
    .from(participations)
    .innerJoin(users, eq(users.id, participations.userId))
    .innerJoin(
      groupMembers,
      and(eq(groupMembers.userId, participations.userId), eq(groupMembers.status, 'approved')),
    )
    .innerJoin(
      theirs,
      and(
        eq(theirs.groupId, groupMembers.groupId),
        eq(theirs.userId, userId),
        eq(theirs.status, 'approved'),
      ),
    )
    .where(
      and(
        eq(participations.resenhaId, resenhaId),
        eq(participations.access, 'approved'),
        ne(participations.userId, userId),
      ),
    )
    .orderBy(asc(users.nickname));
}

/** Pedidos pendentes, para o organizador (RES-05). */
export async function loadRequests(db: Queryable, resenhaId: string): Promise<ResenhaRequest[]> {
  const inviter = alias(users, 'inviter');
  const pending = await db
    .select({
      id: users.id,
      nickname: users.nickname,
      photoUrl: users.photoUrl,
      inviteSource: participations.inviteSource,
      invitedById: inviter.id,
      invitedByNickname: inviter.nickname,
    })
    .from(participations)
    .innerJoin(users, eq(users.id, participations.userId))
    .leftJoin(inviter, eq(inviter.id, participations.invitedBy))
    .where(and(eq(participations.resenhaId, resenhaId), eq(participations.access, 'pending')))
    .orderBy(asc(participations.createdAt));

  return Promise.all(
    pending.map(async (request) => ({
      id: request.id,
      nickname: request.nickname,
      photoUrl: request.photoUrl,
      inviteSource: request.inviteSource as ResenhaRequest['inviteSource'],
      invitedBy:
        request.invitedById && request.invitedByNickname
          ? { id: request.invitedById, nickname: request.invitedByNickname }
          : null,
      commonFriends: await commonFriends(db, resenhaId, request.id),
    })),
  );
}

/** Itens de "quem leva o quê" (DIV-01, DIV-03). */
export async function loadItems(db: Queryable, resenhaId: string): Promise<ResenhaItem[]> {
  const owner = alias(users, 'owner');
  const rows = await db
    .select({
      id: items.id,
      description: items.description,
      status: items.status,
      ownerId: owner.id,
      ownerNickname: owner.nickname,
      createdById: users.id,
      createdByNickname: users.nickname,
    })
    .from(items)
    .innerJoin(users, eq(users.id, items.createdBy))
    .leftJoin(owner, eq(owner.id, items.ownerId))
    .where(eq(items.resenhaId, resenhaId))
    .orderBy(asc(items.createdAt));
  return rows.map((row) => ({
    id: row.id,
    description: row.description,
    status: row.status,
    owner:
      row.ownerId && row.ownerNickname ? { id: row.ownerId, nickname: row.ownerNickname } : null,
    createdBy: { id: row.createdById, nickname: row.createdByNickname },
  }));
}

/** Estado completo, antes de filtrar por quem vê (ver liveFor). */
export interface LiveState extends ResenhaLive {
  organizerId: string;
  hostId: string | null;
}

export async function loadLive(db: Queryable, resenhaId: string): Promise<LiveState> {
  const host = alias(users, 'host');
  const [resenha] = await db
    .select({
      status: resenhas.status,
      organizerId: resenhas.organizerId,
      allowSuggestions: resenhas.allowSuggestions,
      neighborhood: resenhas.neighborhood,
      startsAt: resenhas.startsAt,
      splitModel: resenhas.splitModel,
      exactAddress: resenhas.exactAddress,
      totalCostCents: resenhas.totalCostCents,
      hostId: host.id,
      hostNickname: host.nickname,
    })
    .from(resenhas)
    .leftJoin(host, eq(host.id, resenhas.hostId))
    .where(eq(resenhas.id, resenhaId));
  if (!resenha) throw new Error('resenha não encontrada');
  const { participants, counts } = await loadParticipants(db, resenhaId);
  const totalCostCents = resenha.splitModel === 'equal_split' ? resenha.totalCostCents : null;
  return {
    status: resenha.status as ResenhaStatus,
    organizerId: resenha.organizerId,
    hostId: resenha.hostId,
    counts,
    participants,
    requests: await loadRequests(db, resenhaId),
    polls: await loadPolls(db, resenhaId),
    allowSuggestions: resenha.allowSuggestions,
    neighborhood: resenha.neighborhood,
    startsAt: resenha.startsAt?.toISOString() ?? null,
    splitModel: resenha.splitModel,
    host:
      resenha.hostId && resenha.hostNickname
        ? { id: resenha.hostId, nickname: resenha.hostNickname }
        : null,
    exactAddress: resenha.exactAddress,
    items: resenha.splitModel === 'each_brings' ? await loadItems(db, resenhaId) : [],
    totalCostCents,
    // DIV-02: total ÷ quem vai, para cima no centavo, recalculado a cada confirmação
    perPersonCents:
      totalCostCents !== null && counts.going > 0 ? Math.ceil(totalCostCents / counts.going) : null,
  };
}

/** Organizador ou anfitrião: aprovam, recusam e removem (spec, seção 3). */
export function isManager(state: Pick<LiveState, 'organizerId' | 'hostId'>, userId: string) {
  return userId === state.organizerId || userId === state.hostId;
}

/**
 * O que um participante aprovado recebe. Pedidos só para quem gerencia; o
 * endereço exato só para quem gerencia ou marcou "Vou" (LOC-02).
 */
export function liveFor(state: LiveState, userId: string): ResenhaLive {
  const manager = isManager(state, userId);
  const going = state.participants.some(
    (person) => person.id === userId && person.rsvp === 'going',
  );
  return {
    status: state.status,
    counts: state.counts,
    participants: state.participants,
    requests: manager ? state.requests : [],
    polls: state.polls,
    allowSuggestions: state.allowSuggestions,
    neighborhood: state.neighborhood,
    startsAt: state.startsAt,
    splitModel: state.splitModel,
    host: state.host,
    exactAddress: manager || going ? state.exactAddress : null,
    items: state.items,
    totalCostCents: state.totalCostCents,
    perPersonCents: state.perPersonCents,
  };
}
