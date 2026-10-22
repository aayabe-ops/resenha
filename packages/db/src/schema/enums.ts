import { pgEnum } from 'drizzle-orm/pg-core';

export const consentStatus = pgEnum('consent_status', [
  'not_required',
  'pending',
  'granted',
  'denied',
  'revoked',
]);
export const groupRole = pgEnum('group_role', ['admin', 'member']);
export const membershipStatus = pgEnum('membership_status', ['pending', 'approved', 'removed']);
export const resenhaStatus = pgEnum('resenha_status', ['open', 'decided', 'closed']);
export const accessStatus = pgEnum('access_status', ['pending', 'approved', 'rejected', 'removed']);
export const rsvp = pgEnum('rsvp', ['going', 'maybe', 'not_going']);
export const pollKind = pgEnum('poll_kind', ['where', 'when', 'split']);
export const pollStatus = pgEnum('poll_status', ['open', 'closed']);
export const splitModel = pgEnum('split_model', [
  'equal_split',
  'each_brings',
  'own_drinks',
  'each_their_own',
]);
export const itemStatus = pgEnum('item_status', ['open', 'secured']);
export const reportTarget = pgEnum('report_target', ['user', 'content', 'resenha']);
export const reportStatus = pgEnum('report_status', ['open', 'in_review', 'resolved', 'dismissed']);
export const blockedTermCategory = pgEnum('blocked_term_category', ['alcohol', 'offensive']);
