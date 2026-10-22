import type { Bindings } from './context';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Valida o token do Turnstile. No modo dev (fase local) não há verificação,
 * para nada depender de nuvem (spec, seção 6).
 */
export async function verifyTurnstile(
  env: Pick<Bindings, 'TURNSTILE_MODE' | 'TURNSTILE_SECRET_KEY'>,
  token: string,
  ip: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  if (env.TURNSTILE_MODE === 'dev') return true;
  if (!env.TURNSTILE_SECRET_KEY) throw new Error('TURNSTILE_SECRET_KEY não configurado');

  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET_KEY);
  body.append('response', token);
  if (ip !== 'unknown') body.append('remoteip', ip);

  const response = await fetcher(SITEVERIFY_URL, { method: 'POST', body });
  if (!response.ok) return false;
  const result: { success?: unknown } = await response.json();
  return result.success === true;
}
