// Segurança e moderação (SEG)
import { boolean, foreignKey, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, timestamptz } from './columns';
import { blockedTermCategory, reportStatus, reportTarget } from './enums';
import { users } from './people';
import { resenhas } from './resenhas';

// Toda denúncia entra aqui, a fila da plataforma (SEG-01, SEG-04)
export const reports = pgTable(
  'reports',
  {
    id: id(),
    reporterId: uuid('reporter_id').notNull(),
    targetType: reportTarget('target_type').notNull(),
    targetId: uuid('target_id').notNull(), // id do usuário, conteúdo ou resenha
    resenhaId: uuid('resenha_id'), // para o anfitrião ver as da resenha dele
    reason: text('reason').notNull(), // lista de motivos definida na entrega 8
    details: text('details'), // PII possível; nunca em log
    status: reportStatus('status').notNull().default('open'),
    decision: text('decision'),
    decidedBy: uuid('decided_by'), // moderador da plataforma
    decidedAt: timestamptz('decided_at'),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'reports_reporter_id_fkey',
      columns: [t.reporterId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'reports_resenha_id_fkey',
      columns: [t.resenhaId],
      foreignColumns: [resenhas.id],
    }),
    foreignKey({
      name: 'reports_decided_by_fkey',
      columns: [t.decidedBy],
      foreignColumns: [users.id],
    }),
    index('reports_queue_idx').on(t.status, t.createdAt),
    index('reports_resenha_idx').on(t.resenhaId),
  ],
);

// Termos bloqueados para filtro de texto e regra de álcool (SEG-03, VOT-02)
export const blockedTerms = pgTable(
  'blocked_terms',
  {
    id: id(),
    term: text('term').notNull(),
    category: blockedTermCategory('category').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [unique('blocked_terms_term_category_key').on(t.term, t.category)],
);
