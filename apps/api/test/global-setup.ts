import { resetDatabase } from '@resenha/db/testing';
import { adminDatabaseUrl, TEST_DATABASE } from './database-url';

// Roda em Node antes dos testes: banco próprio, limpo e migrado, para não
// mexer no banco de desenvolvimento.
export default async function setup() {
  try {
    await resetDatabase(adminDatabaseUrl, TEST_DATABASE);
  } catch (error) {
    throw new Error('Não foi possível preparar o banco de testes. Rode `pnpm db:up` antes.', {
      cause: error,
    });
  }
}
