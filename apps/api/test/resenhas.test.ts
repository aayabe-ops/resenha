import type { ResenhaLive, ResenhaView } from '@resenha/shared';
import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { servePreview } from '../src/preview';
import {
  addToGroup,
  api,
  birthDateForAge,
  captureConsole,
  createGroup,
  newGuest,
  newUser,
  resetDatabase,
  sql,
} from './helpers';
import { todayIso } from '@resenha/shared';

let logs: ReturnType<typeof captureConsole>;

beforeEach(async () => {
  await resetDatabase();
  logs = captureConsole();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const tomorrow = () => {
  const date = new Date(`${todayIso()}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

async function createResenha(cookie: string, groupId: string, body: Record<string, unknown> = {}) {
  const response = await api(`/groups/${groupId}/resenhas`, {
    body: {
      name: 'Pré do sábado',
      date: tomorrow(),
      polls: ['where', 'when', 'split'],
      turnstileToken: 'dev',
      ...body,
    },
    cookie,
  });
  return { response, resenha: (await response.json()) as { id: string; inviteCode: string } };
}

async function view(code: string, cookie?: string) {
  return (await api(`/resenhas/code/${code}`, cookie ? { cookie } : {})).json<ResenhaView>();
}

function join(code: string, cookie: string, from?: string) {
  return api(`/resenhas/code/${code}/join`, { body: from ? { from } : {}, cookie });
}

function rsvp(resenhaId: string, cookie: string, value: 'going' | 'maybe' | 'not_going') {
  return api(`/resenhas/${resenhaId}/rsvp`, { body: { rsvp: value }, cookie });
}

function decide(resenhaId: string, cookie: string, userId: string, decision: string) {
  return api(`/resenhas/${resenhaId}/participants/${userId}/${decision}`, {
    method: 'POST',
    cookie,
  });
}

/** Grupo com organizadora (Ana) e uma amiga (Bia), e uma resenha criada pela Ana. */
async function scenario() {
  const ana = await newUser(logs, 'Ana');
  const bia = await newUser(logs, 'Bia');
  const { group } = await createGroup(ana.cookie);
  await addToGroup(ana, bia, group);
  const { resenha } = await createResenha(ana.cookie, group.id);
  return { ana, bia, group, resenha };
}

/** Abre o WebSocket da resenha e guarda as mensagens recebidas. */
async function openLive(resenhaId: string, cookie: string) {
  const response = await exports.default.fetch(`http://localhost/api/resenhas/${resenhaId}/live`, {
    headers: { Upgrade: 'websocket', Cookie: cookie },
  });
  const socket = response.webSocket;
  if (response.status !== 101 || !socket) return { ok: false, status: response.status } as const;
  socket.accept();
  const messages: ResenhaLive[] = [];
  let closeCode: number | null = null;
  const waiters: (() => void)[] = [];
  socket.addEventListener('message', (event) => {
    messages.push(JSON.parse(String(event.data)) as ResenhaLive);
    waiters.splice(0).forEach((resolve) => resolve());
  });
  socket.addEventListener('close', (event) => {
    closeCode = event.code;
    waiters.splice(0).forEach((resolve) => resolve());
  });
  return {
    ok: true,
    status: 101,
    socket,
    messages,
    closeCode: () => closeCode,
    /** Espera a próxima mensagem ou o fechamento, em menos de 1 s (RNF-02). */
    next: (timeoutMs = 1000) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('sem mensagem em 1 s')), timeoutMs);
        waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      }),
  } as const;
}

describe('RES-01: criar resenha', () => {
  it('membro do grupo cria com nome, dia e votações escolhidas, e vira organizador', async () => {
    const { ana, resenha } = await scenario();
    expect(resenha.inviteCode).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const page = await view(resenha.inviteCode, ana.cookie);
    expect(page).toMatchObject({
      name: 'Pré do sábado',
      date: tomorrow(),
      status: 'open',
      organizer: { id: ana.id, nickname: 'Ana' },
      me: { access: 'approved', isOrganizer: true },
    });
    expect(page.polls.map((poll) => poll.kind).sort()).toEqual(['split', 'when', 'where']);
    expect(page.polls.every((poll) => poll.status === 'open')).toBe(true);
  });

  it('nome é opcional e só abre as votações escolhidas', async () => {
    const ana = await newUser(logs, 'Ana');
    const { group } = await createGroup(ana.cookie);
    const { response, resenha } = await createResenha(ana.cookie, group.id, {
      name: null,
      polls: ['when'],
    });
    expect(response.status).toBe(201);
    const page = await view(resenha.inviteCode, ana.cookie);
    expect(page.name).toBeNull();
    expect(page.polls.map((poll) => poll.kind)).toEqual(['when']);
  });

  it('recusa dia no passado, nome com mais de 60 caracteres e quem não é do grupo', async () => {
    const ana = await newUser(logs, 'Ana');
    const outsider = await newUser(logs, 'Fora');
    const { group } = await createGroup(ana.cookie);
    expect(
      (await createResenha(ana.cookie, group.id, { date: '2020-01-01' })).response.status,
    ).toBe(400);
    expect(
      (await createResenha(ana.cookie, group.id, { name: 'x'.repeat(61) })).response.status,
    ).toBe(400);
    expect((await createResenha(outsider.cookie, group.id)).response.status).toBe(404);
  });

  it('aparece nas resenhas ativas do grupo', async () => {
    const { bia, group, resenha } = await scenario();
    const list = await (
      await api(`/groups/${group.id}/resenhas`, { cookie: bia.cookie })
    ).json<{ id: string }[]>();
    expect(list.map((item) => item.id)).toEqual([resenha.id]);
  });
});

describe('RES-02: prévia do link', () => {
  it('mostra nome, dia e bairro, nunca o endereço, e não deixa indexar', async () => {
    const { resenha } = await scenario();
    await sql(
      `update resenhas set neighborhood = 'Pinheiros', exact_address = 'Rua Secreta, 123' where id = $1`,
      [resenha.id],
    );
    const assets = {
      fetch: async () =>
        new Response('<html><head><title>resenha</title></head><body></body></html>', {
          headers: { 'Content-Type': 'text/html' },
        }),
    };
    const response = await servePreview(new Request(`http://localhost/r/${resenha.inviteCode}`), {
      ...env,
      ASSETS: assets,
    } as unknown as typeof env);
    const html = await response.text();
    expect(html).toContain('og:title" content="Pré do sábado"');
    expect(html).toContain('Pinheiros');
    expect(html).toContain('noindex');
    expect(html).not.toContain('Rua Secreta');
  });
});

describe('RES-05: entrar pelo link', () => {
  it('sem sessão, vê só nome, dia, bairro e contagem', async () => {
    const { resenha } = await scenario();
    const page = await view(resenha.inviteCode);
    expect(page.me).toBeNull();
    expect(page.participants).toEqual([]);
    expect(page.requests).toEqual([]);
    expect(page.polls).toEqual([]);
    expect(page.counts).toEqual({ going: 0, maybe: 0, notGoing: 0 });
  });

  it('quem é do grupo entra direto', async () => {
    const { bia, resenha } = await scenario();
    const response = await join(resenha.inviteCode, bia.cookie);
    expect(await response.json()).toEqual({ access: 'approved' });
    const page = await view(resenha.inviteCode, bia.cookie);
    expect(page.participants.map((person) => person.nickname)).toEqual(['Ana', 'Bia']);
  });

  it('quem é de fora fica pendente e não vê a lista; o organizador vê de qual link veio e amigos em comum', async () => {
    const { ana, bia, resenha } = await scenario();
    await join(resenha.inviteCode, bia.cookie);
    // Caio é de fora do grupo da resenha, mas está em outro grupo com a Bia
    const caio = await newUser(logs, 'Caio');
    const { group: other } = await createGroup(bia.cookie, 'Outro');
    await addToGroup(bia, caio, other);

    const response = await join(resenha.inviteCode, caio.cookie, bia.id);
    expect(await response.json()).toEqual({ access: 'pending' });

    const asCaio = await view(resenha.inviteCode, caio.cookie);
    expect(asCaio.me).toMatchObject({ access: 'pending' });
    expect(asCaio.participants).toEqual([]);
    expect(asCaio.counts).toBeDefined();
    expect((await rsvp(resenha.id, caio.cookie, 'going')).status).toBe(403);
    expect((await openLive(resenha.id, caio.cookie)).status).toBe(404);

    const asAna = await view(resenha.inviteCode, ana.cookie);
    expect(asAna.requests).toEqual([
      {
        id: caio.id,
        nickname: 'Caio',
        photoUrl: null,
        inviteSource: 'resenha_link',
        invitedBy: { id: bia.id, nickname: 'Bia' },
        commonFriends: [{ id: bia.id, nickname: 'Bia' }],
      },
    ]);
    // Quem não é organizador não vê os pedidos
    expect((await view(resenha.inviteCode, bia.cookie)).requests).toEqual([]);
  });

  it('"de" só vale se quem compartilhou participa da resenha', async () => {
    const { ana, resenha } = await scenario();
    const caio = await newUser(logs, 'Caio');
    const dani = await newUser(logs, 'Dani');
    await join(resenha.inviteCode, caio.cookie, dani.id);
    const asAna = await view(resenha.inviteCode, ana.cookie);
    expect(asAna.requests[0]?.invitedBy).toBeNull();
  });

  it('o organizador aprova ou recusa; recusado não pede de novo', async () => {
    const { ana, resenha } = await scenario();
    const caio = await newUser(logs, 'Caio');
    const dani = await newUser(logs, 'Dani');
    await join(resenha.inviteCode, caio.cookie);
    await join(resenha.inviteCode, dani.cookie);

    expect((await decide(resenha.id, ana.cookie, caio.id, 'approve')).status).toBe(204);
    expect((await rsvp(resenha.id, caio.cookie, 'going')).status).toBe(204);

    expect((await decide(resenha.id, ana.cookie, dani.id, 'reject')).status).toBe(204);
    expect((await join(resenha.inviteCode, dani.cookie)).status).toBe(403);
    expect((await view(resenha.inviteCode, dani.cookie)).me?.access).toBe('rejected');
  });

  it('só o organizador decide', async () => {
    const { bia, resenha } = await scenario();
    await join(resenha.inviteCode, bia.cookie);
    const caio = await newUser(logs, 'Caio');
    await join(resenha.inviteCode, caio.cookie);
    expect((await decide(resenha.id, bia.cookie, caio.id, 'approve')).status).toBe(404);
    expect((await decide(resenha.id, bia.cookie, caio.id, 'nada')).status).toBe(404);
  });

  it('ACE-01: convidado sem conta entra pelo link e participa depois de aprovado', async () => {
    const { ana, resenha } = await scenario();
    const guest = await newGuest('Visita');
    expect(await (await join(resenha.inviteCode, guest.cookie)).json()).toEqual({
      access: 'pending',
    });
    await decide(resenha.id, ana.cookie, guest.id, 'approve');
    expect((await rsvp(resenha.id, guest.cookie, 'maybe')).status).toBe(204);
  });
});

describe('RES-03 e RES-04: presença ao vivo', () => {
  it('a resposta pode ser trocada e o contador acompanha', async () => {
    const { bia, resenha } = await scenario();
    await join(resenha.inviteCode, bia.cookie);
    await rsvp(resenha.id, bia.cookie, 'going');
    expect((await view(resenha.inviteCode, bia.cookie)).counts).toEqual({
      going: 1,
      maybe: 0,
      notGoing: 0,
    });
    await rsvp(resenha.id, bia.cookie, 'not_going');
    const page = await view(resenha.inviteCode, bia.cookie);
    expect(page.counts).toEqual({ going: 0, maybe: 0, notGoing: 1 });
    expect(page.me?.rsvp).toBe('not_going');
  });

  it('quem está com a página aberta recebe a confirmação em menos de 1 s', async () => {
    const { ana, bia, resenha } = await scenario();
    await join(resenha.inviteCode, bia.cookie);

    const live = await openLive(resenha.id, ana.cookie);
    if (!live.ok) throw new Error('sem WebSocket');
    if (live.messages.length === 0) await live.next(); // estado inicial

    const started = Date.now();
    const waiting = live.next();
    await rsvp(resenha.id, bia.cookie, 'going');
    await waiting;
    expect(Date.now() - started).toBeLessThan(1000);

    const latest = live.messages.at(-1);
    expect(latest?.counts.going).toBe(1);
    expect(latest?.participants.find((person) => person.id === bia.id)?.rsvp).toBe('going');
    live.socket.close();
  });

  it('o organizador recebe os pedidos ao vivo; os outros não', async () => {
    const { ana, bia, resenha } = await scenario();
    await join(resenha.inviteCode, bia.cookie);
    const asAna = await openLive(resenha.id, ana.cookie);
    const asBia = await openLive(resenha.id, bia.cookie);
    if (!asAna.ok || !asBia.ok) throw new Error('sem WebSocket');
    if (asAna.messages.length === 0) await asAna.next();
    if (asBia.messages.length === 0) await asBia.next();

    const caio = await newUser(logs, 'Caio');
    const waitingAna = asAna.next();
    const waitingBia = asBia.next();
    await join(resenha.inviteCode, caio.cookie);
    await Promise.all([waitingAna, waitingBia]);

    expect(asAna.messages.at(-1)?.requests.map((request) => request.id)).toEqual([caio.id]);
    expect(asBia.messages.at(-1)?.requests).toEqual([]);
    asAna.socket.close();
    asBia.socket.close();
  });
});

describe('RES-06: remover alguém', () => {
  it('perde o acesso na hora, inclusive a conexão ao vivo', async () => {
    const { ana, bia, resenha } = await scenario();
    await join(resenha.inviteCode, bia.cookie);
    const asBia = await openLive(resenha.id, bia.cookie);
    if (!asBia.ok) throw new Error('sem WebSocket');
    if (asBia.messages.length === 0) await asBia.next();

    const closing = asBia.next();
    expect((await decide(resenha.id, ana.cookie, bia.id, 'remove')).status).toBe(204);
    await closing;
    expect(asBia.closeCode()).toBe(4403);

    const page = await view(resenha.inviteCode, bia.cookie);
    expect(page.me?.access).toBe('removed');
    expect(page.participants).toEqual([]);
    expect((await rsvp(resenha.id, bia.cookie, 'going')).status).toBe(403);
    expect((await join(resenha.inviteCode, bia.cookie)).status).toBe(403);
    expect((await openLive(resenha.id, bia.cookie)).status).toBe(404);
  });

  it('o organizador não remove a si mesmo', async () => {
    const { ana, resenha } = await scenario();
    expect((await decide(resenha.id, ana.cookie, ana.id, 'remove')).status).toBe(403);
  });
});

describe('RES-07: encerrar', () => {
  it('sai das ativas, entra no histórico e trava as respostas', async () => {
    const { ana, bia, group, resenha } = await scenario();
    await join(resenha.inviteCode, bia.cookie);
    expect(
      (await api(`/resenhas/${resenha.id}/close`, { method: 'POST', cookie: bia.cookie })).status,
    ).toBe(404);
    expect(
      (await api(`/resenhas/${resenha.id}/close`, { method: 'POST', cookie: ana.cookie })).status,
    ).toBe(204);

    const active = await (await api(`/groups/${group.id}/resenhas`, { cookie: ana.cookie })).json();
    expect(active).toEqual([]);
    const history = await (
      await api(`/groups/${group.id}/history`, { cookie: ana.cookie })
    ).json<{ id: string }[]>();
    expect(history.map((item) => item.id)).toEqual([resenha.id]);

    expect((await rsvp(resenha.id, bia.cookie, 'going')).status).toBe(409);
    const caio = await newUser(logs, 'Caio');
    expect((await join(resenha.inviteCode, caio.cookie)).status).toBe(409);
    const [row] = await sql<{ closed: boolean }>(
      'select closed_at is not null as closed from resenhas where id = $1',
      [resenha.id],
    );
    expect(row?.closed).toBe(true);
  });
});

describe('privacidade', () => {
  it('o fluxo da resenha não registra celular nem nascimento no log', async () => {
    const { ana, resenha } = await scenario();
    const guest = await newGuest('Visita', birthDateForAge(17));
    await join(resenha.inviteCode, guest.cookie);
    await decide(resenha.id, ana.cookie, guest.id, 'approve');
    await rsvp(resenha.id, guest.cookie, 'going');
    const output = logs.lines.filter((line) => !line.includes('[whatsapp:dev]')).join('\n');
    expect(output).not.toMatch(/\+55\d+/);
    expect(output).not.toContain(birthDateForAge(17));
  });
});
