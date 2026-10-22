import { connect } from '@resenha/db/client';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

// Teste mínimo do ADR 0007: `pg` conecta ao Postgres pelo binding do
// Hyperdrive dentro do runtime do Workers, sem conta na Cloudflare.
describe('conexão com o Postgres', () => {
  it('responde a select 1 pelo binding HYPERDRIVE', async () => {
    const { db, close } = await connect(env.HYPERDRIVE.connectionString);
    try {
      const result = await db.execute<{ ok: number }>('select 1 as ok');
      expect(result.rows).toEqual([{ ok: 1 }]);
      // Os testes nunca usam o banco de desenvolvimento
      const database = await db.execute<{ name: string }>('select current_database() as name');
      expect(database.rows[0]?.name).toBe('resenha_test');
    } finally {
      await close();
    }
  });
});
