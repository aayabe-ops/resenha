// Grupos (GRP)
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './columns';
import { groupRole, membershipStatus } from './enums';
import { users } from './people';

export const groups = pgTable(
  'groups',
  {
    id: id(),
    name: text('name').notNull(),
    photoUrl: text('photo_url'),
    inviteCode: text('invite_code').notNull().unique('groups_invite_code_key'), // código aleatório do link; sem busca (GRP-02)
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('groups_name_check', sql`char_length(${t.name}) BETWEEN 1 AND 40`),
    foreignKey({
      name: 'groups_created_by_fkey',
      columns: [t.createdBy],
      foreignColumns: [users.id],
    }),
  ],
);

export const groupMembers = pgTable(
  'group_members',
  {
    groupId: uuid('group_id').notNull(),
    userId: uuid('user_id').notNull(),
    role: groupRole('role').notNull().default('member'),
    status: membershipStatus('status').notNull().default('pending'),
    invitedBy: uuid('invited_by'),
    approvedBy: uuid('approved_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'group_members_pkey', columns: [t.groupId, t.userId] }),
    foreignKey({
      name: 'group_members_group_id_fkey',
      columns: [t.groupId],
      foreignColumns: [groups.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'group_members_user_id_fkey',
      columns: [t.userId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'group_members_invited_by_fkey',
      columns: [t.invitedBy],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'group_members_approved_by_fkey',
      columns: [t.approvedBy],
      foreignColumns: [users.id],
    }),
    index('group_members_user_idx').on(t.userId),
  ],
);
