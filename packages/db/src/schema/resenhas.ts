// Resenhas (RES, LOC)
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, timestamptz, updatedAt } from './columns';
import { accessStatus, resenhaStatus, rsvp, splitModel } from './enums';
import { groups } from './groups';
import { users } from './people';

export const resenhas = pgTable(
  'resenhas',
  {
    id: id(),
    groupId: uuid('group_id').notNull(),
    organizerId: uuid('organizer_id').notNull(),
    hostId: uuid('host_id'), // anfitrião, definido quando "onde" fecha
    name: text('name'),
    date: date('date', { mode: 'string' }).notNull(),
    startsAt: timestamptz('starts_at'), // definido quando "horário" fecha
    neighborhood: text('neighborhood'), // bairro; o único dado de local público (LOC-01)
    exactAddress: text('exact_address'), // PII; só para aprovados e confirmados (LOC-02)
    inviteCode: text('invite_code').notNull().unique('resenhas_invite_code_key'),
    status: resenhaStatus('status').notNull().default('open'),
    splitModel: splitModel('split_model'), // definido quando "divisão" fecha (VOT-06)
    totalCostCents: integer('total_cost_cents'), // rateio (DIV-02)
    allowSuggestions: boolean('allow_suggestions').notNull().default(true), // VOT-03
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    closedAt: timestamptz('closed_at'), // RES-07
    addressPurgedAt: timestamptz('address_purged_at'), // preenchido quando o Cron apaga o endereço (LOC-03)
  },
  (t) => [
    check('resenhas_name_check', sql`${t.name} IS NULL OR char_length(${t.name}) BETWEEN 1 AND 60`),
    check(
      'resenhas_total_cost_cents_check',
      sql`${t.totalCostCents} IS NULL OR ${t.totalCostCents} >= 0`,
    ),
    foreignKey({
      name: 'resenhas_group_id_fkey',
      columns: [t.groupId],
      foreignColumns: [groups.id],
    }),
    foreignKey({
      name: 'resenhas_organizer_id_fkey',
      columns: [t.organizerId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'resenhas_host_id_fkey',
      columns: [t.hostId],
      foreignColumns: [users.id],
    }),
    index('resenhas_group_idx').on(t.groupId, t.date.desc().nullsFirst()),
    // Fila do Cron de LOC-03: resenhas encerradas com endereço ainda presente
    index('resenhas_address_purge_idx')
      .on(t.closedAt)
      .where(sql`exact_address IS NOT NULL AND closed_at IS NOT NULL`),
  ],
);

// Quem está na resenha, com acesso e resposta (RES-03, RES-05, RES-06)
export const participations = pgTable(
  'participations',
  {
    resenhaId: uuid('resenha_id').notNull(),
    userId: uuid('user_id').notNull(),
    access: accessStatus('access').notNull().default('pending'),
    rsvp: rsvp('rsvp'),
    inviteSource: text('invite_source').notNull(),
    invitedBy: uuid('invited_by'), // de quem era o link (RES-05)
    decidedBy: uuid('decided_by'), // quem aprovou ou recusou
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'participations_pkey', columns: [t.resenhaId, t.userId] }),
    check(
      'participations_invite_source_check',
      sql`${t.inviteSource} IN ('group_link', 'resenha_link')`,
    ),
    foreignKey({
      name: 'participations_resenha_id_fkey',
      columns: [t.resenhaId],
      foreignColumns: [resenhas.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'participations_user_id_fkey',
      columns: [t.userId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'participations_invited_by_fkey',
      columns: [t.invitedBy],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'participations_decided_by_fkey',
      columns: [t.decidedBy],
      foreignColumns: [users.id],
    }),
    index('participations_user_idx').on(t.userId),
  ],
);
