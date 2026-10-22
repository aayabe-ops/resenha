import { timestamp, uuid } from 'drizzle-orm/pg-core';

// Convenções de docs/db/schema.sql: chave uuid com gen_random_uuid() e
// datas em timestamptz (UTC).
export const id = () => uuid('id').primaryKey().defaultRandom();
export const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
export const createdAt = () => timestamptz('created_at').notNull().defaultNow();
export const updatedAt = () => timestamptz('updated_at').notNull().defaultNow();
