import { connect } from '@resenha/db/client';
import { todayIso } from '@resenha/shared';
import { env, exports } from 'cloudflare:workers';
import { vi } from 'vitest';

export const TEST_IP = '203.0.113.10';

/** Chama a API pelo Worker real. */
export function api(
  path: string,
  options: { method?: string; body?: unknown; cookie?: string; ip?: string } = {},
) {
  const headers = new Headers({ 'CF-Connecting-IP': options.ip ?? TEST_IP });
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (options.cookie) headers.set('Cookie', options.cookie);
  return exports.default.fetch(`http://localhost/api${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers,
    body: options.body === undefined ? null : JSON.stringify(options.body),
  });
}

/** Executa SQL direto no banco de testes. */
export async function sql<T extends Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const { db, close } = await connect(env.HYPERDRIVE.connectionString);
  try {
    const client = db.$client;
    return (await client.query<T>(text, params)).rows;
  } finally {
    await close();
  }
}

export async function resetDatabase() {
  await sql(
    `TRUNCATE users, guardians, consents, login_codes, login_ip_requests, sessions, blocks,
      groups, group_members, resenhas, participations, polls, poll_options, votes, items,
      reports, blocked_terms, events RESTART IDENTITY CASCADE`,
  );
}

export async function countRows(table: string): Promise<number> {
  const [row] = await sql<{ total: string }>(`select count(*) as total from ${table}`);
  return Number(row?.total ?? 0);
}

/** Data de nascimento de quem tem `years` anos completos hoje (+ dias). */
export function birthDateForAge(years: number, plusDays = 0): string {
  const [y, m, d] = todayIso().split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y - years, m - 1, d));
  if (date.getUTCMonth() !== m - 1) date.setUTCDate(0); // 29/02 em ano não bissexto
  date.setUTCDate(date.getUTCDate() + plusDays);
  return date.toISOString().slice(0, 10);
}

/** Captura tudo o que o Worker escreve no console. */
export function captureConsole() {
  const lines: string[] = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    });
  }
  return {
    lines,
    lastCode(): string {
      const line = lines.findLast((entry) => entry.includes('[whatsapp:dev]'));
      const code = line?.match(/(\d{6})$/)?.[1];
      if (!code) throw new Error('Nenhum código no console');
      return code;
    },
  };
}

export function sessionCookie(response: Response): string {
  const header = response.headers.get('Set-Cookie') ?? '';
  const match = header.match(/(__Host-resenha_session=[^;]+)/);
  if (!match?.[1]) throw new Error('Resposta sem cookie de sessão');
  return match[1];
}

/** Cria um usuário pelo fluxo completo de login e devolve o cookie. */
export async function registerUser(
  logs: ReturnType<typeof captureConsole>,
  { phone = '+5511988887777', nickname = 'Ju', birthDate = birthDateForAge(20) } = {},
) {
  const sent = await api('/auth/code', { body: { phone, birthDate, turnstileToken: 'dev' } });
  if (sent.status !== 202) throw new Error(`código não enviado: ${sent.status}`);
  const verified = await api('/auth/verify', { body: { phone, code: logs.lastCode() } });
  const { registrationToken } = await verified.json<{ registrationToken: string }>();
  const registered = await api('/auth/register', {
    body: { registrationToken, nickname, birthDate },
  });
  if (registered.status !== 201) throw new Error(`cadastro falhou: ${registered.status}`);
  return sessionCookie(registered);
}
