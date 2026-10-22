import { databaseUrl, LOCAL_DATABASE_URL } from '@resenha/db/testing';

export const TEST_DATABASE = 'resenha_test';
export const adminDatabaseUrl = process.env.DATABASE_URL ?? LOCAL_DATABASE_URL;
export const testDatabaseUrl = databaseUrl(adminDatabaseUrl, TEST_DATABASE);
