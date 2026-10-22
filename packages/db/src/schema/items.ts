// Itens (DIV)
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './columns';
import { itemStatus } from './enums';
import { users } from './people';
import { resenhas } from './resenhas';

export const items = pgTable(
  'items',
  {
    id: id(),
    resenhaId: uuid('resenha_id').notNull(),
    description: text('description').notNull(),
    ownerId: uuid('owner_id'), // no máximo um responsável (DIV-01)
    estimatedCostCents: integer('estimated_cost_cents'),
    status: itemStatus('status').notNull().default('open'), // DIV-03
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('items_description_check', sql`char_length(${t.description}) BETWEEN 1 AND 60`),
    check(
      'items_estimated_cost_cents_check',
      sql`${t.estimatedCostCents} IS NULL OR ${t.estimatedCostCents} >= 0`,
    ),
    foreignKey({
      name: 'items_resenha_id_fkey',
      columns: [t.resenhaId],
      foreignColumns: [resenhas.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'items_owner_id_fkey',
      columns: [t.ownerId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'items_created_by_fkey',
      columns: [t.createdBy],
      foreignColumns: [users.id],
    }),
    index('items_resenha_idx').on(t.resenhaId),
  ],
);
