import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  api,
  birthDateForAge,
  captureConsole,
  countRows,
  resetDatabase,
  sessionCookie,
  sql,
} from './helpers';

const phone = '+5511999990000';
const adult = birthDateForAge(20);

function requestCode(body: Record<string, unknown> = {}, ip?: string) {
  return api('/auth/code', {
    body: { phone, birthDate: adult, turnstileToken: 'dev', ...body },
    ...(ip ? { ip } : {}),
  });
}

let logs: ReturnType<typeof captureConsole>;

beforeEach(async () => {
  await resetDatabase();
  logs = captureConsole();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ACE-03: menos de 15 anos', () => {
  it('recusa o pedido de código sem gravar nada, nem o celular', async () => {
    const response = await requestCode({ birthDate: birthDateForAge(15, 1) });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'under_age' });
    expect(await countRows('login_codes')).toBe(0);
    expect(await countRows('login_ip_requests')).toBe(0);
    expect(await countRows('users')).toBe(0);
    expect(logs.lines.some((line) => line.includes('[whatsapp:dev]'))).toBe(false);
  });

  it('aceita quem faz 15 anos hoje', async () => {
    expect((await requestCode({ birthDate: birthDateForAge(15) })).status).toBe(202);
  });

  it('recusa o cadastro abaixo de 15 sem criar usuário', async () => {
    await requestCode();
    const verified = await api('/auth/verify', { body: { phone, code: logs.lastCode() } });
    const { registrationToken } = await verified.json<{ registrationToken: string }>();

    const response = await api('/auth/register', {
      body: { registrationToken, nickname: 'Lu', birthDate: birthDateForAge(14) },
    });

    expect(response.status).toBe(403);
    expect(await countRows('users')).toBe(0);
  });
});

describe('ACE-02: login por código', () => {
  it('guarda só o hash do código, válido por 10 min', async () => {
    expect((await requestCode()).status).toBe(202);

    const [row] = await sql<{ code_hash: string; ttl: number }>(
      `select code_hash, extract(epoch from expires_at - created_at)::int as ttl from login_codes`,
    );
    expect(row?.code_hash).not.toContain(logs.lastCode());
    expect(row?.ttl).toBe(600);
  });

  it('entra com o código certo e cria sessão com cookie httpOnly, Secure e SameSite=Lax', async () => {
    await requestCode();
    const verified = await api('/auth/verify', { body: { phone, code: logs.lastCode() } });
    expect(verified.status).toBe(200);
    const body = await verified.json<{ status: string; registrationToken: string }>();
    expect(body.status).toBe('needs_registration');

    const registered = await api('/auth/register', {
      body: { registrationToken: body.registrationToken, nickname: 'Ju', birthDate: adult },
    });
    expect(registered.status).toBe(201);
    const setCookie = registered.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Max-Age=2592000/);

    const me = await api('/me', { cookie: sessionCookie(registered) });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ nickname: 'Ju', isGuest: false, isMinor: false });

    // No banco, só o hash do token da sessão
    const token = sessionCookie(registered).split('=')[1] ?? '';
    const [session] = await sql<{ token_hash: string }>('select token_hash from sessions');
    expect(session?.token_hash).not.toBe(token);
  });

  it('quem já tem conta entra direto', async () => {
    await requestCode();
    const first = await api('/auth/verify', { body: { phone, code: logs.lastCode() } });
    const { registrationToken } = await first.json<{ registrationToken: string }>();
    await api('/auth/register', { body: { registrationToken, nickname: 'Ju', birthDate: adult } });

    await requestCode();
    const second = await api('/auth/verify', { body: { phone, code: logs.lastCode() } });
    expect(await second.json()).toEqual({ status: 'logged_in' });
    expect(sessionCookie(second)).toBeTruthy();
  });

  it('o código expira em 10 min', async () => {
    await requestCode();
    await sql(`update login_codes set expires_at = now() - interval '1 second'`);

    const response = await api('/auth/verify', { body: { phone, code: logs.lastCode() } });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_code' });
  });

  it('o código só vale uma vez', async () => {
    await requestCode();
    const code = logs.lastCode();
    await api('/auth/verify', { body: { phone, code } });
    expect((await api('/auth/verify', { body: { phone, code } })).status).toBe(400);
  });

  it('5 tentativas erradas bloqueiam por 15 min, mesmo com o código certo', async () => {
    await requestCode();
    const code = logs.lastCode();
    const wrong = code === '000000' ? '111111' : '000000';

    for (let attempt = 1; attempt <= 4; attempt++) {
      const response = await api('/auth/verify', { body: { phone, code: wrong } });
      expect(response.status).toBe(400);
    }
    const fifth = await api('/auth/verify', { body: { phone, code: wrong } });
    expect(fifth.status).toBe(429);
    expect(await fifth.json()).toEqual({ error: 'code_locked' });

    const withRightCode = await api('/auth/verify', { body: { phone, code } });
    expect(withRightCode.status).toBe(429);

    const [row] = await sql<{ minutes: number }>(
      `select round(extract(epoch from locked_until - now()) / 60)::int as minutes from login_codes`,
    );
    expect(row?.minutes).toBe(15);

    // Enquanto bloqueado, também não recebe código novo
    expect((await requestCode()).status).toBe(429);
  });

  it('o bloqueio passa depois de 15 min', async () => {
    await requestCode();
    await sql(
      `update login_codes set attempts = 5, locked_until = now() - interval '1 second',
        created_at = now() - interval '20 minutes', expires_at = now() - interval '10 minutes'`,
    );
    expect((await requestCode()).status).toBe(202);
  });

  it('limita a 3 códigos por número a cada 15 min', async () => {
    for (let i = 0; i < 3; i++) expect((await requestCode()).status).toBe(202);
    const fourth = await requestCode();
    expect(fourth.status).toBe(429);
    expect(await fourth.json()).toEqual({ error: 'rate_limited' });

    await sql(`update login_codes set created_at = now() - interval '16 minutes'`);
    expect((await requestCode()).status).toBe(202);
  });

  it('limita a 10 códigos por IP a cada hora e guarda só o hash do IP', async () => {
    const ip = '198.51.100.7';
    for (let i = 0; i < 10; i++) {
      const response = await requestCode(
        { phone: `+55119999900${String(i).padStart(2, '0')}` },
        ip,
      );
      expect(response.status).toBe(202);
    }
    const eleventh = await requestCode({ phone: '+5511999990099' }, ip);
    expect(eleventh.status).toBe(429);

    // Outro IP continua podendo pedir
    expect((await requestCode({ phone: '+5511999990098' }, '198.51.100.8')).status).toBe(202);

    const rows = await sql<{ ip_hash: string }>('select ip_hash from login_ip_requests');
    expect(rows.every((row) => !row.ip_hash.includes(ip))).toBe(true);
  });

  it('recusa celular fora do formato E.164', async () => {
    expect((await requestCode({ phone: '11999990000' })).status).toBe(400);
  });

  it('recusa token de cadastro adulterado', async () => {
    await requestCode();
    const verified = await api('/auth/verify', { body: { phone, code: logs.lastCode() } });
    const { registrationToken } = await verified.json<{ registrationToken: string }>();
    const tampered = registrationToken.replace(/^[^.]+/, btoa('+5511000000000'));

    const response = await api('/auth/register', {
      body: { registrationToken: tampered, nickname: 'Ju', birthDate: adult },
    });
    expect(response.status).toBe(401);
    expect(await countRows('users')).toBe(0);
  });
});
