import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import worker from '../src/index';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureConsole, countRows, registerUser, resetDatabase, sql } from './helpers';

let logs: ReturnType<typeof captureConsole>;

beforeEach(async () => {
  await resetDatabase();
  logs = captureConsole();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('limpeza agendada (Cron)', () => {
  it('apaga só o que venceu, mantendo códigos que ainda bloqueiam', async () => {
    await registerUser(logs, { phone: '+5511911110001' });
    await registerUser(logs, { phone: '+5511911110002' });
    await sql(`update sessions set expires_at = now() - interval '1 second'
      where id = (select id from sessions order by created_at limit 1)`);

    await sql(`insert into login_codes (phone_e164, code_hash, expires_at, locked_until) values
      ('+5511911110003', 'a', now() - interval '1 minute', null),
      ('+5511911110004', 'b', now() - interval '1 minute', now() + interval '5 minutes'),
      ('+5511911110005', 'c', now() + interval '5 minutes', null)`);
    await sql(`insert into login_ip_requests (ip_hash, created_at) values
      ('velho', now() - interval '61 minutes'), ('novo', now())`);
    const ipBefore = await countRows('login_ip_requests');

    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: '*/15 * * * *' }), env, ctx);
    await waitOnExecutionContext(ctx);

    expect(await countRows('sessions')).toBe(1);
    const codes = await sql<{ phone_e164: string }>(
      'select phone_e164 from login_codes order by phone_e164',
    );
    expect(codes.map((row) => row.phone_e164)).toEqual(['+5511911110004', '+5511911110005']);
    expect(await countRows('login_ip_requests')).toBe(ipBefore - 1);
  });
});
