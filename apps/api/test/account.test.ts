import { neutralBirthDate } from '@resenha/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  api,
  birthDateForAge,
  captureConsole,
  countRows,
  registerUser,
  resetDatabase,
  sessionCookie,
  sql,
} from './helpers';

let logs: ReturnType<typeof captureConsole>;

beforeEach(async () => {
  await resetDatabase();
  logs = captureConsole();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function createGuest(birthDate = birthDateForAge(16), nickname = 'Convidada') {
  const response = await api('/guests', { body: { nickname, birthDate } });
  return { response, cookie: response.status === 201 ? sessionCookie(response) : '' };
}

describe('ACE-01: convidado sem conta', () => {
  it('participa com apelido e nascimento, sem celular', async () => {
    const { response, cookie } = await createGuest();
    expect(response.status).toBe(201);

    const me = await api('/me', { cookie });
    expect(await me.json()).toMatchObject({ nickname: 'Convidada', isGuest: true });
    const [user] = await sql<{ phone_e164: string | null }>('select phone_e164 from users');
    expect(user?.phone_e164).toBeNull();
  });

  it('abaixo de 15 anos é recusado sem gravar dados (ACE-03)', async () => {
    const { response } = await createGuest(birthDateForAge(14));
    expect(response.status).toBe(403);
    expect(await countRows('users')).toBe(0);
    expect(await countRows('sessions')).toBe(0);
  });

  it('limita a 10 convidados por IP a cada hora, separado do limite do login', async () => {
    const ip = '198.51.100.20';
    for (let i = 0; i < 10; i++) {
      const response = await api('/guests', {
        body: { nickname: `Visita ${i}`, birthDate: birthDateForAge(16) },
        ip,
      });
      expect(response.status).toBe(201);
    }
    const eleventh = await api('/guests', {
      body: { nickname: 'Visita 10', birthDate: birthDateForAge(16) },
      ip,
    });
    expect(eleventh.status).toBe(429);
    expect(await eleventh.json()).toEqual({ error: 'rate_limited' });

    // O mesmo IP ainda pode pedir código de login
    const code = await api('/auth/code', {
      body: { phone: '+5511944445555', birthDate: birthDateForAge(20), turnstileToken: 'dev' },
      ip,
    });
    expect(code.status).toBe(202);

    // Passada a janela de 1 h, volta a aceitar
    await sql(`update login_ip_requests set created_at = now() - interval '61 minutes'`);
    const later = await api('/guests', {
      body: { nickname: 'Visita 11', birthDate: birthDateForAge(16) },
      ip,
    });
    expect(later.status).toBe(201);
  });

  it('recusa apelido vazio ou com mais de 30 caracteres', async () => {
    expect((await createGuest(birthDateForAge(16), '   ')).response.status).toBe(400);
    expect((await createGuest(birthDateForAge(16), 'x'.repeat(31))).response.status).toBe(400);
  });
});

describe('ACE-04: conta de 15 a 17 anos', () => {
  it('fica marcada como menor, com consentimento pendente', async () => {
    const cookie = await registerUser(logs, { birthDate: birthDateForAge(17) });
    expect(await (await api('/me', { cookie })).json()).toMatchObject({ isMinor: true });
    const [user] = await sql<{ consent_status: string }>('select consent_status from users');
    expect(user?.consent_status).toBe('pending');
  });

  it('adulto não precisa de consentimento', async () => {
    const cookie = await registerUser(logs, { birthDate: birthDateForAge(18) });
    expect(await (await api('/me', { cookie })).json()).toMatchObject({ isMinor: false });
    const [user] = await sql<{ consent_status: string }>('select consent_status from users');
    expect(user?.consent_status).toBe('not_required');
  });
});

describe('ACE-05: perfil de outra pessoa', () => {
  it('mostra só id, apelido e foto; nunca celular ou nascimento', async () => {
    const viewer = await registerUser(logs, { phone: '+5511911112222', nickname: 'Ana' });
    await registerUser(logs, { phone: '+5511933334444', nickname: 'Bia' });
    const [bia] = await sql<{ id: string }>(`select id from users where nickname = 'Bia'`);

    const response = await api(`/users/${bia?.id}`, { cookie: viewer });
    expect(response.status).toBe(200);
    const profile = await response.json();
    expect(profile).toEqual({ id: bia?.id, nickname: 'Bia', photoUrl: null });
    expect(JSON.stringify(profile)).not.toContain('5511933334444');
  });

  it('exige sessão e não lista ninguém', async () => {
    await registerUser(logs);
    const [user] = await sql<{ id: string }>('select id from users');
    expect((await api(`/users/${user?.id}`)).status).toBe(401);
    expect((await api('/users')).status).toBe(404);
  });

  it('id inexistente dá 404', async () => {
    const cookie = await registerUser(logs);
    const response = await api('/users/00000000-0000-4000-8000-000000000000', { cookie });
    expect(response.status).toBe(404);
  });
});

describe('ACE-06: excluir a conta', () => {
  it('apaga os dados pessoais na hora e mantém a linha como ex-participante', async () => {
    const birthDate = birthDateForAge(16);
    const cookie = await registerUser(logs, { phone: '+5511955556666', birthDate });
    const [before] = await sql<{ id: string }>('select id from users');

    const response = await api('/me', { method: 'DELETE', cookie });
    expect(response.status).toBe(204);

    const [user] = await sql<Record<string, unknown>>(
      `select nickname, photo_url, phone_e164, phone_verified_at, to_char(birth_date, 'YYYY-MM-DD') as birth_date, deleted_at from users where id = $1`,
      [before?.id],
    );
    expect(user).toMatchObject({
      nickname: 'ex-participante',
      photo_url: null,
      phone_e164: null,
      phone_verified_at: null,
      birth_date: neutralBirthDate(birthDate),
    });
    expect(user?.deleted_at).not.toBeNull();
  });

  it('revoga as sessões e apaga os códigos do celular', async () => {
    const phone = '+5511977778888';
    const cookie = await registerUser(logs, { phone });
    await api('/auth/code', {
      body: { phone, birthDate: birthDateForAge(20), turnstileToken: 'dev' },
    });

    await api('/me', { method: 'DELETE', cookie });

    expect((await api('/me', { cookie })).status).toBe(401);
    expect(await countRows('login_codes')).toBe(0);
    const [sessions] = await sql<{ active: string }>(
      'select count(*) as active from sessions where revoked_at is null',
    );
    expect(Number(sessions?.active)).toBe(0);
  });

  it('o celular pode criar uma conta nova depois', async () => {
    const phone = '+5511900001111';
    const cookie = await registerUser(logs, { phone });
    await api('/me', { method: 'DELETE', cookie });

    await registerUser(logs, { phone, nickname: 'De novo' });
    expect(await countRows('users')).toBe(2);
  });
});

describe('sessão', () => {
  it('sem cookie ou com cookie inválido dá 401', async () => {
    expect((await api('/me')).status).toBe(401);
    expect((await api('/me', { cookie: '__Host-resenha_session=invalido' })).status).toBe(401);
  });

  it('dura 30 dias e é renovada com o uso', async () => {
    const cookie = await registerUser(logs);
    const [created] = await sql<{ days: number }>(
      `select round(extract(epoch from expires_at - now()) / 86400)::int as days from sessions`,
    );
    expect(created?.days).toBe(30);

    await sql(`update sessions set expires_at = now() + interval '10 days'`);
    const response = await api('/me', { cookie });
    expect(response.status).toBe(200);
    expect(response.headers.get('Set-Cookie')).toMatch(/Max-Age=2592000/);
    const [renewed] = await sql<{ days: number }>(
      `select round(extract(epoch from expires_at - now()) / 86400)::int as days from sessions`,
    );
    expect(renewed?.days).toBe(30);
  });

  it('sessão vencida não vale', async () => {
    const cookie = await registerUser(logs);
    await sql(`update sessions set expires_at = now() - interval '1 second'`);
    expect((await api('/me', { cookie })).status).toBe(401);
  });

  it('sair revoga a sessão', async () => {
    const cookie = await registerUser(logs);
    expect((await api('/auth/logout', { method: 'POST', cookie })).status).toBe(204);
    expect((await api('/me', { cookie })).status).toBe(401);
  });
});
