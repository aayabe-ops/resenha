import { healthResponseSchema } from '@resenha/shared';
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('GET /api/health', () => {
  it('responde 200 com status ok', async () => {
    const response = await exports.default.fetch('http://localhost/api/health');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(healthResponseSchema.parse(await response.json())).toEqual({ status: 'ok' });
  });

  it('responde 404 para rota de API inexistente', async () => {
    const response = await exports.default.fetch('http://localhost/api/nao-existe');

    expect(response.status).toBe(404);
  });
});
