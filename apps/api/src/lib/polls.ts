// Regras das votações (VOT-01 a VOT-07). A fonte da verdade é o Postgres;
// o Durable Object chama estas funções e avisa as mudanças ao vivo.
import type { Database } from '@resenha/db/client';
import { participations, pollOptions, polls, resenhas, users, votes } from '@resenha/db';
import type { Poll, PollKind, SplitModel } from '@resenha/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

type Queryable = Pick<Database, 'select' | 'update' | 'insert'>;

// VOT-02. TODO(copy): revisar
export const SPLIT_LABELS: Record<SplitModel, string> = {
  equal_split: 'Rateio igual',
  each_brings: 'Cada um leva uma coisa',
  own_drinks: 'Só bebida',
  each_their_own: 'Cada um com o seu',
};

const DEFAULT_SPLIT_MODELS: SplitModel[] = ['equal_split', 'each_brings', 'own_drinks'];

export async function createDefaultOptions(db: Queryable, pollId: string, kind: PollKind) {
  if (kind !== 'split') return;
  await db.insert(pollOptions).values(
    DEFAULT_SPLIT_MODELS.map((model) => ({
      pollId,
      label: SPLIT_LABELS[model],
      splitModel: model,
    })),
  );
}

/**
 * Sem álcool para menores (CLAUDE.md; VOT-02): se algum participante
 * aprovado for menor, "só bebida" vira "cada um com o seu", mantendo os
 * votos, e a regra já decidida também muda. Não volta atrás.
 */
export async function applyMinorRule(db: Queryable, resenhaId: string): Promise<void> {
  const [minor] = await db
    .select({ userId: participations.userId })
    .from(participations)
    .innerJoin(users, eq(users.id, participations.userId))
    .where(
      and(
        eq(participations.resenhaId, resenhaId),
        eq(participations.access, 'approved'),
        sql`age((now() at time zone 'America/Sao_Paulo')::date, ${users.birthDate}) < interval '18 years'`,
      ),
    )
    .limit(1);
  if (!minor) return;

  await db
    .update(pollOptions)
    .set({ splitModel: 'each_their_own', label: SPLIT_LABELS.each_their_own })
    .where(
      and(
        eq(pollOptions.splitModel, 'own_drinks'),
        inArray(
          pollOptions.pollId,
          db.select({ id: polls.id }).from(polls).where(eq(polls.resenhaId, resenhaId)),
        ),
      ),
    );
  await db
    .update(resenhas)
    .set({ splitModel: 'each_their_own', updatedAt: sql`now()` })
    .where(and(eq(resenhas.id, resenhaId), eq(resenhas.splitModel, 'own_drinks')));
}

/** Opções mais votadas; sem votos, todas empatam. */
export function leaders(poll: Pick<Poll, 'options'>): string[] {
  const most = Math.max(0, ...poll.options.map((option) => option.voters.length));
  return poll.options.filter((option) => option.voters.length === most).map((option) => option.id);
}

export async function loadPolls(db: Pick<Database, 'select'>, resenhaId: string): Promise<Poll[]> {
  const pollRows = await db
    .select({
      id: polls.id,
      kind: polls.kind,
      status: polls.status,
      closesAt: polls.closesAt,
      winningOptionId: polls.winningOptionId,
    })
    .from(polls)
    .where(eq(polls.resenhaId, resenhaId))
    .orderBy(asc(polls.createdAt), asc(polls.kind));
  if (pollRows.length === 0) return [];
  const pollIds = pollRows.map((poll) => poll.id);

  const optionRows = await db
    .select({
      id: pollOptions.id,
      pollId: pollOptions.pollId,
      label: pollOptions.label,
      splitModel: pollOptions.splitModel,
      suggestedById: users.id,
      suggestedByNickname: users.nickname,
    })
    .from(pollOptions)
    .leftJoin(users, eq(users.id, pollOptions.suggestedBy))
    .where(inArray(pollOptions.pollId, pollIds))
    // Mesma criação: ordem do enum (rateio, cada um leva, bebida)
    .orderBy(asc(pollOptions.createdAt), asc(pollOptions.splitModel), asc(pollOptions.label));

  const voteRows = await db
    .select({ optionId: votes.optionId, id: users.id, nickname: users.nickname })
    .from(votes)
    .innerJoin(users, eq(users.id, votes.userId))
    .where(inArray(votes.pollId, pollIds))
    .orderBy(asc(votes.createdAt));

  return pollRows.map((poll) => {
    const options = optionRows
      .filter((option) => option.pollId === poll.id)
      .map((option) => ({
        id: option.id,
        label: option.label,
        splitModel: option.splitModel,
        suggestedBy:
          option.suggestedById && option.suggestedByNickname
            ? { id: option.suggestedById, nickname: option.suggestedByNickname }
            : null,
        voters: voteRows
          .filter((vote) => vote.optionId === option.id)
          .map(({ id, nickname }) => ({ id, nickname })),
      }));
    const closedWithoutWinner =
      poll.status === 'closed' && poll.winningOptionId === null && options.length > 0;
    return {
      id: poll.id,
      kind: poll.kind,
      status: poll.status,
      closesAt: poll.closesAt?.toISOString() ?? null,
      winningOptionId: poll.winningOptionId,
      tiedOptionIds: closedWithoutWinner ? leaders({ options }) : [],
      options,
    };
  });
}

/** VOT-06: a vencedora vira a regra da resenha. */
export async function applyWinner(
  db: Queryable,
  resenhaId: string,
  pollId: string,
  optionId: string,
): Promise<void> {
  const [option] = await db
    .select({
      label: pollOptions.label,
      splitModel: pollOptions.splitModel,
      neighborhood: pollOptions.neighborhood,
      kind: polls.kind,
    })
    .from(pollOptions)
    .innerJoin(polls, eq(polls.id, pollOptions.pollId))
    .where(and(eq(pollOptions.id, optionId), eq(pollOptions.pollId, pollId)));
  if (!option) throw new Error('opção não pertence à votação');

  await db
    .update(polls)
    .set({ winningOptionId: optionId })
    .where(and(eq(polls.id, pollId), isNull(polls.winningOptionId)));

  if (option.kind === 'split' && option.splitModel) {
    await db
      .update(resenhas)
      .set({ splitModel: option.splitModel, updatedAt: sql`now()` })
      .where(eq(resenhas.id, resenhaId));
  } else if (option.kind === 'when') {
    // Hora no dia da resenha, no fuso de São Paulo
    await db
      .update(resenhas)
      .set({
        startsAt: sql`(${resenhas.date} + ${option.label}::time) at time zone 'America/Sao_Paulo'`,
        updatedAt: sql`now()`,
      })
      .where(eq(resenhas.id, resenhaId));
  } else if (option.kind === 'where') {
    await db
      .update(resenhas)
      .set({ neighborhood: option.neighborhood ?? option.label, updatedAt: sql`now()` })
      .where(eq(resenhas.id, resenhaId));
  }
  await markDecidedIfDone(db, resenhaId);
}

/** Com todas as votações decididas, a resenha passa a "decidida". */
export async function markDecidedIfDone(db: Queryable, resenhaId: string): Promise<void> {
  const current = await loadPolls(db, resenhaId);
  const done = current.every(
    (poll) => poll.status === 'closed' && (poll.winningOptionId || poll.options.length === 0),
  );
  if (!done) return;
  await db
    .update(resenhas)
    .set({ status: 'decided', updatedAt: sql`now()` })
    .where(and(eq(resenhas.id, resenhaId), eq(resenhas.status, 'open')));
}
