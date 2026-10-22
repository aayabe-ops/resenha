// Pessoas, acesso e consentimento. Nomes de constraints iguais aos que o
// Postgres gera para docs/db/schema.sql.
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  smallint,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, timestamptz, updatedAt } from './columns';
import { consentStatus } from './enums';

export const users = pgTable(
  'users',
  {
    id: id(),
    nickname: text('nickname').notNull(),
    photoUrl: text('photo_url'), // armazenamento em aberto (questões em aberto #4)
    phoneE164: text('phone_e164').unique('users_phone_e164_key'), // PII; nulo para convidado sem login (ACE-01)
    phoneVerifiedAt: timestamptz('phone_verified_at'),
    birthDate: date('birth_date', { mode: 'string' }).notNull(), // PII; 15+ garantido pela aplicação (ACE-03)
    consentStatus: consentStatus('consent_status').notNull().default('not_required'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamptz('deleted_at'), // exclusão de conta (ACE-06)
  },
  (t) => [
    check('users_nickname_check', sql`char_length(${t.nickname}) BETWEEN 1 AND 30`),
    check(
      'users_phone_e164_check',
      sql`${t.phoneE164} IS NULL OR ${t.phoneE164} ~ '^\\+[1-9][0-9]{7,14}$'`,
    ),
  ],
);

// Responsável legal de usuário menor (ACE-04)
export const guardians = pgTable(
  'guardians',
  {
    id: id(),
    name: text('name').notNull(), // PII
    phoneE164: text('phone_e164'), // PII
    email: text('email'), // PII
    createdAt: createdAt(),
  },
  (t) => [check('guardians_check', sql`${t.phoneE164} IS NOT NULL OR ${t.email} IS NOT NULL`)],
);

// Histórico de consentimentos; users.consent_status guarda o estado atual
export const consents = pgTable(
  'consents',
  {
    id: id(),
    userId: uuid('user_id').notNull(),
    guardianId: uuid('guardian_id').notNull(),
    status: consentStatus('status').notNull(),
    termsVersion: text('terms_version').notNull(), // versão dos termos aceitos
    requestedAt: timestamptz('requested_at').notNull().defaultNow(),
    decidedAt: timestamptz('decided_at'),
    revokedAt: timestamptz('revoked_at'),
  },
  (t) => [
    foreignKey({
      name: 'consents_user_id_fkey',
      columns: [t.userId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'consents_guardian_id_fkey',
      columns: [t.guardianId],
      foreignColumns: [guardians.id],
    }),
    index('consents_user_idx').on(t.userId),
  ],
);

// Códigos de login pelo WhatsApp (ACE-02); expirados são apagados por Cron
export const loginCodes = pgTable(
  'login_codes',
  {
    id: id(),
    phoneE164: text('phone_e164').notNull(), // PII
    codeHash: text('code_hash').notNull(), // nunca o código em claro
    attempts: smallint('attempts').notNull().default(0),
    expiresAt: timestamptz('expires_at').notNull(), // criação + 10 min
    lockedUntil: timestamptz('locked_until'), // 5 tentativas erradas → 15 min
    createdAt: createdAt(),
  },
  (t) => [index('login_codes_phone_idx').on(t.phoneE164, t.createdAt.desc().nullsFirst())],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id').notNull(),
    tokenHash: text('token_hash').notNull().unique('sessions_token_hash_key'), // cookie httpOnly guarda o token; aqui só o hash
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: createdAt(),
    revokedAt: timestamptz('revoked_at'),
  },
  (t) => [
    foreignKey({
      name: 'sessions_user_id_fkey',
      columns: [t.userId],
      foreignColumns: [users.id],
    }),
    index('sessions_user_idx').on(t.userId),
  ],
);

// Bloqueio entre usuários (SEG-02)
export const blocks = pgTable(
  'blocks',
  {
    blockerId: uuid('blocker_id').notNull(),
    blockedId: uuid('blocked_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'blocks_pkey', columns: [t.blockerId, t.blockedId] }),
    foreignKey({
      name: 'blocks_blocker_id_fkey',
      columns: [t.blockerId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'blocks_blocked_id_fkey',
      columns: [t.blockedId],
      foreignColumns: [users.id],
    }),
    check('blocks_check', sql`${t.blockerId} <> ${t.blockedId}`),
    index('blocks_blocked_idx').on(t.blockedId),
  ],
);
