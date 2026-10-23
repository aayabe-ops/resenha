import { describe, expect, it, vi } from 'vitest';
import { verifyTurnstile } from '../src/lib/turnstile';

const live = { TURNSTILE_MODE: 'live', TURNSTILE_SECRET_KEY: 'segredo' };

describe('Turnstile', () => {
  it('no modo dev não chama a Cloudflare', async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(await verifyTurnstile({ TURNSTILE_MODE: 'dev' }, 'x', '1.2.3.4', fetcher)).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('no modo real envia segredo, token e IP ao siteverify', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ success: true }));
    expect(await verifyTurnstile(live, 'token-do-widget', '1.2.3.4', fetcher)).toBe(true);

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const body = init?.body as FormData;
    expect(body.get('secret')).toBe('segredo');
    expect(body.get('response')).toBe('token-do-widget');
    expect(body.get('remoteip')).toBe('1.2.3.4');
  });

  it('recusa quando a Cloudflare nega ou responde com erro', async () => {
    const denied = vi.fn<typeof fetch>(async () => Response.json({ success: false }));
    expect(await verifyTurnstile(live, 't', '1.2.3.4', denied)).toBe(false);
    const failing = vi.fn<typeof fetch>(async () => new Response('erro', { status: 500 }));
    expect(await verifyTurnstile(live, 't', '1.2.3.4', failing)).toBe(false);
  });

  it('sem segredo no modo real, falha em vez de liberar', async () => {
    await expect(verifyTurnstile({ TURNSTILE_MODE: 'live' }, 't', '1.2.3.4')).rejects.toThrow();
  });
});
