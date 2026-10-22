// Votações (VOT)
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  type PgTableExtraConfigValue,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, timestamptz, updatedAt } from './columns';
import { pollKind, pollStatus, splitModel } from './enums';
import { users } from './people';
import { resenhas } from './resenhas';

export const polls = pgTable(
  'polls',
  {
    id: id(),
    resenhaId: uuid('resenha_id').notNull(),
    kind: pollKind('kind').notNull(),
    status: pollStatus('status').notNull().default('open'),
    closesAt: timestamptz('closes_at'), // prazo opcional (VOT-05)
    winningOptionId: uuid('winning_option_id'),
    createdAt: createdAt(),
    closedAt: timestamptz('closed_at'),
  },
  // Tipo explícito por causa da referência circular com poll_options.
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: 'polls_resenha_id_fkey',
      columns: [t.resenhaId],
      foreignColumns: [resenhas.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'polls_winning_option_fk',
      columns: [t.winningOptionId],
      foreignColumns: [pollOptions.id],
    }),
    unique('polls_resenha_id_kind_key').on(t.resenhaId, t.kind), // uma votação de cada tipo por resenha no MVP
  ],
);

export const pollOptions = pgTable(
  'poll_options',
  {
    id: id(),
    pollId: uuid('poll_id').notNull(),
    label: text('label').notNull(),
    splitModel: splitModel('split_model'), // preenchido só nas opções da votação 'split'
    suggestedBy: uuid('suggested_by'), // nulo = opção padrão do sistema
    offeredHomeBy: uuid('offered_home_by'), // "pode ser lá em casa" (DIV-04); só em 'where'
    neighborhood: text('neighborhood'), // bairro exibido para opções de casa
    createdAt: createdAt(),
  },
  (t) => [
    check('poll_options_label_check', sql`char_length(${t.label}) BETWEEN 1 AND 60`),
    foreignKey({
      name: 'poll_options_poll_id_fkey',
      columns: [t.pollId],
      foreignColumns: [polls.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'poll_options_suggested_by_fkey',
      columns: [t.suggestedBy],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'poll_options_offered_home_by_fkey',
      columns: [t.offeredHomeBy],
      foreignColumns: [users.id],
    }),
    index('poll_options_poll_idx').on(t.pollId),
  ],
);

// Um voto por pessoa por votação, trocável até fechar (VOT-04)
export const votes = pgTable(
  'votes',
  {
    pollId: uuid('poll_id').notNull(),
    userId: uuid('user_id').notNull(),
    optionId: uuid('option_id').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'votes_pkey', columns: [t.pollId, t.userId] }),
    foreignKey({
      name: 'votes_poll_id_fkey',
      columns: [t.pollId],
      foreignColumns: [polls.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'votes_user_id_fkey',
      columns: [t.userId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'votes_option_id_fkey',
      columns: [t.optionId],
      foreignColumns: [pollOptions.id],
    }).onDelete('cascade'),
    index('votes_option_idx').on(t.optionId),
  ],
);
