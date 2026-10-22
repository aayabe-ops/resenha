// Métricas de produto (RNF-12) — sem dado pessoal nas propriedades
import { sql } from 'drizzle-orm';
import { bigint, foreignKey, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt } from './columns';
import { users } from './people';
import { resenhas } from './resenhas';

export const events = pgTable(
  'events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    name: text('name').notNull(), // ex.: resenha_created, vote_cast, card_shared
    userId: uuid('user_id'),
    resenhaId: uuid('resenha_id'),
    properties: jsonb('properties')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'events_user_id_fkey',
      columns: [t.userId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'events_resenha_id_fkey',
      columns: [t.resenhaId],
      foreignColumns: [resenhas.id],
    }).onDelete('set null'),
    index('events_name_time_idx').on(t.name, t.createdAt),
  ],
);
