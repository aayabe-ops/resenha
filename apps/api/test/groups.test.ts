import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, birthDateForAge, captureConsole, registerUser, resetDatabase, sql } from './helpers';

let logs: ReturnType<typeof captureConsole>;

beforeEach(async () => {
  await resetDatabase();
  logs = captureConsole();
});

afterEach(() => {
  vi.restoreAllMocks();
});

let phoneCounter = 0;
async function newUser(nickname: string) {
  phoneCounter += 1;
  const phone = `+55119${String(10_000_000 + phoneCounter).padStart(8, '0')}`;
  const cookie = await registerUser(logs, { phone, nickname });
  const [row] = await sql<{ id: string }>('select id from users where phone_e164 = $1', [phone]);
  return { cookie, id: row?.id ?? '' };
}

async function createGroup(cookie: string, name = 'Galera do 3º') {
  const response = await api('/groups', { body: { name }, cookie });
  return { response, group: (await response.json()) as { id: string; inviteCode: string } };
}

async function join(cookie: string, inviteCode: string) {
  return api(`/invites/${inviteCode}/join`, { method: 'POST', cookie });
}

async function approve(adminCookie: string, groupId: string, userId: string) {
  return api(`/groups/${groupId}/members/${userId}/approve`, {
    method: 'POST',
    cookie: adminCookie,
  });
}

async function remove(adminCookie: string, groupId: string, userId: string) {
  return api(`/groups/${groupId}/members/${userId}/remove`, {
    method: 'POST',
    cookie: adminCookie,
  });
}

describe('GRP-01: criar grupo', () => {
  it('cria com link de convite único e o criador vira admin', async () => {
    const ana = await newUser('Ana');
    const first = await createGroup(ana.cookie);
    const second = await createGroup(ana.cookie, 'Outro');

    expect(first.response.status).toBe(201);
    expect(first.group.inviteCode).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(first.group.inviteCode).not.toBe(second.group.inviteCode);

    const detail = await api(`/groups/${first.group.id}`, { cookie: ana.cookie });
    expect(await detail.json()).toMatchObject({
      name: 'Galera do 3º',
      role: 'admin',
      members: [{ id: ana.id, nickname: 'Ana', role: 'admin' }],
    });
  });

  it('valida o nome (1 a 40 caracteres)', async () => {
    const ana = await newUser('Ana');
    expect((await createGroup(ana.cookie, '  ')).response.status).toBe(400);
    expect((await createGroup(ana.cookie, 'x'.repeat(41))).response.status).toBe(400);
  });

  it('exige login com celular: convidado não cria grupo', async () => {
    const guest = await api('/guests', {
      body: { nickname: 'Visita', birthDate: birthDateForAge(16) },
    });
    const cookie = (guest.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';
    const response = await api('/groups', { body: { name: 'Grupo' }, cookie });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'phone_required' });
  });

  it('sem sessão dá 401', async () => {
    expect((await api('/groups', { body: { name: 'Grupo' } })).status).toBe(401);
  });
});

describe('GRP-02: nada encontrável sem o link', () => {
  it('"meus grupos" mostra só os grupos em que a pessoa é membro aprovada', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const { group } = await createGroup(ana.cookie, 'Da Ana');
    await createGroup(bia.cookie, 'Da Bia');
    await join(bia.cookie, group.inviteCode); // pendente

    const list = await (await api('/groups', { cookie: bia.cookie })).json<{ name: string }[]>();
    expect(list.map((item) => item.name)).toEqual(['Da Bia']);
  });

  it('quem não é membro não vê o grupo nem o histórico, nem com o id', async () => {
    const ana = await newUser('Ana');
    const intrusa = await newUser('Intrusa');
    const { group } = await createGroup(ana.cookie);

    expect((await api(`/groups/${group.id}`, { cookie: intrusa.cookie })).status).toBe(404);
    expect((await api(`/groups/${group.id}/history`, { cookie: intrusa.cookie })).status).toBe(404);
  });

  it('não existe rota de busca de grupos', async () => {
    const ana = await newUser('Ana');
    expect((await api('/groups?q=galera', { cookie: ana.cookie })).status).toBe(200);
    const result = await (await api('/groups?q=galera', { cookie: ana.cookie })).json();
    expect(result).toEqual([]);
    expect((await api('/groups/search?q=galera', { cookie: ana.cookie })).status).toBe(404);
  });

  it('link inválido dá 404', async () => {
    const ana = await newUser('Ana');
    expect((await api('/invites/abc', { cookie: ana.cookie })).status).toBe(404);
    expect((await api(`/invites/${'x'.repeat(22)}`, { cookie: ana.cookie })).status).toBe(404);
  });
});

describe('GRP-03: entrar pelo link, com aprovação', () => {
  it('pelo link vê só o nome e fica pendente até o admin aprovar', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const { group } = await createGroup(ana.cookie);

    const invite = await api(`/invites/${group.inviteCode}`, { cookie: bia.cookie });
    expect(await invite.json()).toEqual({ groupId: group.id, name: 'Galera do 3º', status: null });

    const joined = await join(bia.cookie, group.inviteCode);
    expect(joined.status).toBe(201);
    expect(await joined.json()).toEqual({ status: 'pending' });

    // Pendente não vê o grupo
    expect((await api(`/groups/${group.id}`, { cookie: bia.cookie })).status).toBe(404);

    // O admin vê o pedido
    const detail = await (
      await api(`/groups/${group.id}`, { cookie: ana.cookie })
    ).json<{
      pending: { id: string }[];
    }>();
    expect(detail.pending.map((person) => person.id)).toEqual([bia.id]);

    expect((await approve(ana.cookie, group.id, bia.id)).status).toBe(204);
    const asMember = await api(`/groups/${group.id}`, { cookie: bia.cookie });
    expect(asMember.status).toBe(200);
    expect(await asMember.json()).toMatchObject({ role: 'member', pending: [] });
  });

  it('pedir de novo não duplica', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const { group } = await createGroup(ana.cookie);
    await join(bia.cookie, group.inviteCode);
    const again = await join(bia.cookie, group.inviteCode);
    expect(await again.json()).toEqual({ status: 'pending' });
  });

  it('só o admin aprova ou remove', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const caio = await newUser('Caio');
    const { group } = await createGroup(ana.cookie);
    await join(bia.cookie, group.inviteCode);
    await approve(ana.cookie, group.id, bia.id);
    await join(caio.cookie, group.inviteCode);

    expect((await approve(bia.cookie, group.id, caio.id)).status).toBe(404);
    expect((await remove(bia.cookie, group.id, caio.id)).status).toBe(404);
    const [row] = await sql<{ status: string }>(
      'select status from group_members where user_id = $1',
      [caio.id],
    );
    expect(row?.status).toBe('pending');
  });

  it('o admin remove a qualquer momento e a pessoa perde o acesso na hora', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const { group } = await createGroup(ana.cookie);
    await join(bia.cookie, group.inviteCode);
    await approve(ana.cookie, group.id, bia.id);

    expect((await remove(ana.cookie, group.id, bia.id)).status).toBe(204);
    expect((await api(`/groups/${group.id}`, { cookie: bia.cookie })).status).toBe(404);
    const list = await (await api('/groups', { cookie: bia.cookie })).json();
    expect(list).toEqual([]);
  });

  it('recusado ou removido não pede de novo pelo mesmo link', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const { group } = await createGroup(ana.cookie);
    await join(bia.cookie, group.inviteCode);
    await remove(ana.cookie, group.id, bia.id); // recusa o pedido

    const again = await join(bia.cookie, group.inviteCode);
    expect(again.status).toBe(403);
    const invite = await (await api(`/invites/${group.inviteCode}`, { cookie: bia.cookie })).json();
    expect(invite).toMatchObject({ status: 'removed' });
  });

  it('o admin não remove a si mesmo', async () => {
    const ana = await newUser('Ana');
    const { group } = await createGroup(ana.cookie);
    expect((await remove(ana.cookie, group.id, ana.id)).status).toBe(403);
  });

  it('o grupo aceita até 200 membros aprovados (RNF-06)', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const { group } = await createGroup(ana.cookie);
    // 199 membros além da Ana, inseridos direto no banco
    await sql(
      `with new_users as (
         insert into users (nickname, birth_date)
         select 'm' || n, '2000-01-01' from generate_series(1, 199) as n
         returning id
       )
       insert into group_members (group_id, user_id, status)
       select $1, id, 'approved' from new_users`,
      [group.id],
    );
    await join(bia.cookie, group.inviteCode);

    const response = await approve(ana.cookie, group.id, bia.id);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'group_full' });
  });
});

describe('GRP-04: histórico', () => {
  it('membro vê as resenhas encerradas, da mais nova para a mais antiga', async () => {
    const ana = await newUser('Ana');
    const { group } = await createGroup(ana.cookie);
    await sql(
      `insert into resenhas (group_id, organizer_id, name, date, invite_code, status, neighborhood)
       values ($1, $2, 'Antiga', '2026-08-01', 'r1', 'closed', 'Pinheiros'),
              ($1, $2, 'Nova', '2026-10-01', 'r2', 'closed', null),
              ($1, $2, 'Aberta', '2026-11-01', 'r3', 'open', null)`,
      [group.id, ana.id],
    );

    const history = await (
      await api(`/groups/${group.id}/history`, { cookie: ana.cookie })
    ).json<{ name: string }[]>();
    expect(history.map((item) => item.name)).toEqual(['Nova', 'Antiga']);
    expect(history[1]).toMatchObject({ date: '2026-08-01', neighborhood: 'Pinheiros' });
    expect(Object.keys(history[0] ?? {}).sort()).toEqual(['date', 'id', 'name', 'neighborhood']);
  });
});

describe('pendências da entrega 2', () => {
  it('ACE-05: o perfil mostra os grupos em comum', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const { group } = await createGroup(ana.cookie, 'Em comum');
    await createGroup(ana.cookie, 'Só da Ana');
    await join(bia.cookie, group.inviteCode);
    await approve(ana.cookie, group.id, bia.id);

    const profile = await (await api(`/users/${ana.id}`, { cookie: bia.cookie })).json();
    expect(profile).toMatchObject({ commonGroups: [{ id: group.id, name: 'Em comum' }] });
  });

  it('ACE-06: quem exclui a conta sai dos grupos e o admin passa ao membro aprovado mais antigo', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const caio = await newUser('Caio');
    const { group } = await createGroup(ana.cookie);
    await join(bia.cookie, group.inviteCode);
    await join(caio.cookie, group.inviteCode);
    await approve(ana.cookie, group.id, caio.id);
    await approve(ana.cookie, group.id, bia.id);
    // Bia pediu antes do Caio, então é a membro mais antiga
    await api('/me', { method: 'DELETE', cookie: ana.cookie });

    const rows = await sql<{ user_id: string; role: string; status: string }>(
      'select user_id, role, status from group_members where group_id = $1',
      [group.id],
    );
    const byUser = Object.fromEntries(rows.map((row) => [row.user_id, row]));
    expect(byUser[ana.id]).toMatchObject({ status: 'removed', role: 'member' });
    expect(byUser[bia.id]).toMatchObject({ status: 'approved', role: 'admin' });
    expect(byUser[caio.id]).toMatchObject({ status: 'approved', role: 'member' });
  });

  it('ACE-06: grupo sem outros membros fica sem admin', async () => {
    const ana = await newUser('Ana');
    const { group } = await createGroup(ana.cookie);
    await api('/me', { method: 'DELETE', cookie: ana.cookie });
    const [row] = await sql<{ admins: string }>(
      `select count(*) as admins from group_members where group_id = $1 and role = 'admin' and status = 'approved'`,
      [group.id],
    );
    expect(Number(row?.admins)).toBe(0);
  });
});
