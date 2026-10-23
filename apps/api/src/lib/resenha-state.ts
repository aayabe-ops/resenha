// Leituras do estado de uma resenha, usadas pela página (Worker) e pelo
// Durable Object ao avisar as mudanças. A fonte da verdade é o Postgres.
import type { Database } from '@resenha/db/client';
import { groupMembers, participations, resenhas, users } from '@resenha/db';
import type {
  ResenhaCounts,
  ResenhaLive,
  ResenhaParticipant,
  ResenhaRequest,
  ResenhaStatus,
} from '@resenha/shared';
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

export async function loadLive(
  db: Queryable,
  resenhaId: string,
): Promise<ResenhaLive & { organizerId: string }> {
  const [resenha] = await db
    .select({ status: resenhas.status, organizerId: resenhas.organizerId })
    .from(resenhas)
    .where(eq(resenhas.id, resenhaId));
  if (!resenha) throw new Error('resenha não encontrada');
  const { participants, counts } = await loadParticipants(db, resenhaId);
  return {
    status: resenha.status as ResenhaStatus,
    organizerId: resenha.organizerId,
    counts,
    participants,
    requests: await loadRequests(db, resenhaId),
  };
}
