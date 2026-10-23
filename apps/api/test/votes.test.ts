import type { Poll, ResenhaView } from '@resenha/shared';
import { runDurableObjectAlarm } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import {
  createResenha,
  decide,
  join,
  openLive,
  scenario as scenarioWith,
  tomorrow,
  view,
} from './resenha-helpers';

let logs: ReturnType<typeof captureConsole>;

beforeEach(async () => {
  await resetDatabase();
  logs = captureConsole();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Ana organiza; Bia é do grupo e já entrou na resenha. */
async function scenario() {
  const base = await scenarioWith(logs);
  await join(base.resenha.inviteCode, base.bia.cookie);
  return base;
}

function pollOf(page: ResenhaView, kind: Poll['kind']): Poll {
  const poll = page.polls.find((item) => item.kind === kind);
  if (!poll) throw new Error(`sem votação ${kind}`);
  return poll;
}

async function poll(code: string, cookie: string, kind: Poll['kind']) {
  return pollOf(await view(code, cookie), kind);
}

function suggest(resenhaId: string, pollId: string, cookie: string, label: string) {
  return api(`/resenhas/${resenhaId}/polls/${pollId}/options`, { body: { label }, cookie });
}

function vote(resenhaId: string, pollId: string, cookie: string, optionId: string) {
  return api(`/resenhas/${resenhaId}/polls/${pollId}/vote`, { body: { optionId }, cookie });
}

function closePoll(resenhaId: string, pollId: string, cookie: string, optionId?: string) {
  return api(`/resenhas/${resenhaId}/polls/${pollId}/close`, {
    body: optionId ? { optionId } : {},
    cookie,
  });
}

describe('VOT-01 e VOT-02: votações e opções padrão', () => {
  it('a resenha nasce com onde, horário e divisão; a divisão com os 3 modelos', async () => {
    const { ana, resenha } = await scenario();
    const page = await view(resenha.inviteCode, ana.cookie);
    expect(page.polls.map((item) => item.kind).sort()).toEqual(['split', 'when', 'where']);
    expect(pollOf(page, 'split').options.map((option) => option.splitModel)).toEqual([
      'equal_split',
      'each_brings',
      'own_drinks',
    ]);
    expect(pollOf(page, 'where').options).toEqual([]);
    expect(pollOf(page, 'when').options).toEqual([]);
  });

  it('com menor aprovado, "só bebida" vira "cada um com o seu" e os votos ficam', async () => {
    const { ana, bia, group, resenha } = await scenario();
    const split = await poll(resenha.inviteCode, ana.cookie, 'split');
    const drinks = split.options.find((option) => option.splitModel === 'own_drinks');
    await vote(resenha.id, split.id, bia.cookie, drinks?.id ?? '');

    const teen = await newUser(logs, 'Teca');
    await sql(`update users set birth_date = $1 where id = $2`, [birthDateForAge(16), teen.id]);
    await addToGroup(ana, teen, group);
    await join(resenha.inviteCode, teen.cookie);

    const after = await poll(resenha.inviteCode, ana.cookie, 'split');
    const changed = after.options.find((option) => option.id === drinks?.id);
    expect(changed).toMatchObject({ splitModel: 'each_their_own', label: 'Cada um com o seu' });
    expect(changed?.voters.map((voter) => voter.id)).toEqual([bia.id]);
    expect(after.options.some((option) => option.splitModel === 'own_drinks')).toBe(false);

    // Não volta atrás se o menor sair
    await decide(resenha.id, ana.cookie, teen.id, 'remove');
    const later = await poll(resenha.inviteCode, ana.cookie, 'split');
    expect(later.options.some((option) => option.splitModel === 'own_drinks')).toBe(false);
  });

  it('convidado menor aprovado também muda a opção', async () => {
    const { ana, resenha } = await scenario();
    const guest = await newGuest('Visita', birthDateForAge(15));
    await join(resenha.inviteCode, guest.cookie);
    await decide(resenha.id, ana.cookie, guest.id, 'approve');
    const split = await poll(resenha.inviteCode, ana.cookie, 'split');
    expect(split.options.map((option) => option.splitModel)).toContain('each_their_own');
  });

  it('organizador menor: a resenha já nasce sem "só bebida"', async () => {
    const teen = await newUser(logs, 'Teca');
    await sql(`update users set birth_date = $1 where id = $2`, [birthDateForAge(17), teen.id]);
    const { group } = await createGroup(teen.cookie);
    const { resenha } = await createResenha(teen.cookie, group.id);
    const split = await poll(resenha.inviteCode, teen.cookie, 'split');
    expect(split.options.map((option) => option.splitModel)).toEqual([
      'equal_split',
      'each_brings',
      'each_their_own',
    ]);
  });
});

describe('VOT-03: sugestões', () => {
  it('participante sugere onde e horário; o horário é uma hora válida', async () => {
    const { ana, bia, resenha } = await scenario();
    const where = await poll(resenha.inviteCode, bia.cookie, 'where');
    const when = await poll(resenha.inviteCode, bia.cookie, 'when');
    expect((await suggest(resenha.id, where.id, bia.cookie, 'Pinheiros')).status).toBe(204);
    expect((await suggest(resenha.id, when.id, bia.cookie, '21:00')).status).toBe(204);
    expect((await suggest(resenha.id, when.id, bia.cookie, 'de noite')).status).toBe(400);
    expect((await suggest(resenha.id, when.id, bia.cookie, '25:00')).status).toBe(400);

    const page = await view(resenha.inviteCode, ana.cookie);
    expect(pollOf(page, 'where').options[0]).toMatchObject({
      label: 'Pinheiros',
      suggestedBy: { id: bia.id, nickname: 'Bia' },
    });
  });

  it('com a sugestão travada, só o organizador acrescenta', async () => {
    const { ana, bia, resenha } = await scenario();
    const where = await poll(resenha.inviteCode, bia.cookie, 'where');
    await api(`/resenhas/${resenha.id}/suggestions`, {
      body: { allow: false },
      cookie: ana.cookie,
    });
    expect((await suggest(resenha.id, where.id, bia.cookie, 'Lapa')).status).toBe(403);
    expect((await suggest(resenha.id, where.id, ana.cookie, 'Lapa')).status).toBe(204);
    // Só o organizador muda a liberação
    const byBia = await api(`/resenhas/${resenha.id}/suggestions`, {
      body: { allow: true },
      cookie: bia.cookie,
    });
    expect(byBia.status).toBe(404);
  });

  it('divisão não aceita sugestão', async () => {
    const { ana, resenha } = await scenario();
    const split = await poll(resenha.inviteCode, ana.cookie, 'split');
    expect((await suggest(resenha.id, split.id, ana.cookie, 'Pix')).status).toBe(403);
  });

  it('o filtro bloqueia termos da lista, sem ligar para maiúscula ou acento', async () => {
    const { bia, resenha } = await scenario();
    await sql(
      `insert into blocked_terms (term, category) values ('cerveja', 'alcohol'), ('palavrão feio', 'offensive')`,
    );
    const where = await poll(resenha.inviteCode, bia.cookie, 'where');

    const blocked = await suggest(resenha.id, where.id, bia.cookie, 'Bar da CERVÉJA');
    expect(blocked.status).toBe(422);
    expect(await blocked.json()).toEqual({ error: 'blocked_text' });
    expect((await suggest(resenha.id, where.id, bia.cookie, 'Palavrao  FEIO total')).status).toBe(
      422,
    );
    // Palavra inteira: "cervejaria" não é "cerveja"
    expect((await suggest(resenha.id, where.id, bia.cookie, 'Perto da cervejaria')).status).toBe(
      204,
    );
    // Termo desativado não bloqueia
    await sql(`update blocked_terms set active = false where term = 'cerveja'`);
    expect((await suggest(resenha.id, where.id, bia.cookie, 'Cerveja Hall')).status).toBe(204);
  });
});

describe('VOT-07: nada sobre pessoas', () => {
  it('bloqueia apelido de alguém da resenha ou do grupo e menções com @', async () => {
    const { ana, bia, group, resenha } = await scenario();
    const caio = await newUser(logs, 'Caio Ç');
    await addToGroup(ana, caio, group); // está no grupo, mas não entrou na resenha
    const where = await poll(resenha.inviteCode, bia.cookie, 'where');

    expect((await suggest(resenha.id, where.id, bia.cookie, 'Casa da Ana')).status).toBe(422);
    expect((await suggest(resenha.id, where.id, bia.cookie, 'onde a bia quiser')).status).toBe(422);
    expect((await suggest(resenha.id, where.id, bia.cookie, 'Lá no caio c')).status).toBe(422);
    expect((await suggest(resenha.id, where.id, bia.cookie, 'perto do @fulano')).status).toBe(422);
    // Palavra inteira: "Anapolis" não cita a Ana
    expect((await suggest(resenha.id, where.id, bia.cookie, 'Praça Anapolis')).status).toBe(204);
  });
});

describe('VOT-04: votar', () => {
  it('um voto por pessoa, trocável, com quem votou em quê', async () => {
    const { ana, bia, resenha } = await scenario();
    const split = await poll(resenha.inviteCode, ana.cookie, 'split');
    const [first, second] = split.options;
    await vote(resenha.id, split.id, bia.cookie, first?.id ?? '');
    await vote(resenha.id, split.id, ana.cookie, first?.id ?? '');
    await vote(resenha.id, split.id, bia.cookie, second?.id ?? '');

    const after = await poll(resenha.inviteCode, ana.cookie, 'split');
    expect(after.options[0]?.voters.map((voter) => voter.nickname)).toEqual(['Ana']);
    expect(after.options[1]?.voters.map((voter) => voter.nickname)).toEqual(['Bia']);
    const [row] = await sql<{ total: string }>(
      'select count(*) as total from votes where poll_id = $1',
      [split.id],
    );
    expect(Number(row?.total)).toBe(2);
  });

  it('o placar chega a quem está com a página aberta em menos de 1 s', async () => {
    const { ana, bia, resenha } = await scenario();
    const split = await poll(resenha.inviteCode, ana.cookie, 'split');
    const live = await openLive(resenha.id, ana.cookie);
    if (!live.ok) throw new Error('sem WebSocket');
    if (live.messages.length === 0) await live.next();

    const started = Date.now();
    const waiting = live.next();
    await vote(resenha.id, split.id, bia.cookie, split.options[0]?.id ?? '');
    await waiting;
    expect(Date.now() - started).toBeLessThan(1000);
    const latest = live.messages.at(-1)?.polls.find((item) => item.id === split.id);
    expect(latest?.options[0]?.voters).toEqual([{ id: bia.id, nickname: 'Bia' }]);
    live.socket.close();
  });

  it('quem não é participante aprovado não vota; opção de outra votação não vale', async () => {
    const { ana, resenha } = await scenario();
    const outsider = await newUser(logs, 'Fora');
    await join(resenha.inviteCode, outsider.cookie); // pendente
    const split = await poll(resenha.inviteCode, ana.cookie, 'split');
    const where = await poll(resenha.inviteCode, ana.cookie, 'where');
    expect(
      (await vote(resenha.id, split.id, outsider.cookie, split.options[0]?.id ?? '')).status,
    ).toBe(404);
    expect((await vote(resenha.id, where.id, ana.cookie, split.options[0]?.id ?? '')).status).toBe(
      404,
    );
  });
});

describe('VOT-05 e VOT-06: fechar, empate e vencedora', () => {
  it('o organizador fecha; a vencedora vira a regra e a votação trava', async () => {
    const { ana, bia, resenha } = await scenario();
    const split = await poll(resenha.inviteCode, ana.cookie, 'split');
    const equal = split.options.find((option) => option.splitModel === 'equal_split');
    await vote(resenha.id, split.id, bia.cookie, equal?.id ?? '');

    expect((await closePoll(resenha.id, split.id, bia.cookie)).status).toBe(404);
    expect((await closePoll(resenha.id, split.id, ana.cookie)).status).toBe(204);

    const page = await view(resenha.inviteCode, ana.cookie);
    expect(pollOf(page, 'split')).toMatchObject({ status: 'closed', winningOptionId: equal?.id });
    expect(page.splitModel).toBe('equal_split');
    const late = await vote(resenha.id, split.id, ana.cookie, equal?.id ?? '');
    expect(late.status).toBe(409);
    expect(await late.json()).toEqual({ error: 'poll_closed' });
  });

  it('em empate, a votação trava e o organizador escolhe entre as empatadas', async () => {
    const { ana, bia, resenha } = await scenario();
    const when = await poll(resenha.inviteCode, ana.cookie, 'when');
    await suggest(resenha.id, when.id, ana.cookie, '20:00');
    await suggest(resenha.id, when.id, ana.cookie, '21:30');
    await suggest(resenha.id, when.id, ana.cookie, '23:00');
    const options = (await poll(resenha.inviteCode, ana.cookie, 'when')).options;
    await vote(resenha.id, when.id, ana.cookie, options[0]?.id ?? '');
    await vote(resenha.id, when.id, bia.cookie, options[1]?.id ?? '');

    const tie = await closePoll(resenha.id, when.id, ana.cookie);
    expect(tie.status).toBe(409);
    expect(await tie.json()).toEqual({ error: 'tie' });
    const closed = await poll(resenha.inviteCode, ana.cookie, 'when');
    expect(closed.status).toBe('closed');
    expect(closed.tiedOptionIds.sort()).toEqual([options[0]?.id, options[1]?.id].sort());

    // Fora do empate não vale
    expect((await closePoll(resenha.id, when.id, ana.cookie, options[2]?.id)).status).toBe(400);
    expect((await closePoll(resenha.id, when.id, ana.cookie, options[1]?.id)).status).toBe(204);

    const page = await view(resenha.inviteCode, ana.cookie);
    expect(pollOf(page, 'when').winningOptionId).toBe(options[1]?.id);
    // 21:30 no dia da resenha, no fuso de São Paulo (-03:00)
    expect(page.startsAt).toBe(new Date(`${tomorrow()}T21:30:00-03:00`).toISOString());
  });

  it('sem votos, todas as opções empatam; sem opções, fecha sem vencedora', async () => {
    const { ana, resenha } = await scenario();
    const split = await poll(resenha.inviteCode, ana.cookie, 'split');
    expect((await closePoll(resenha.id, split.id, ana.cookie)).status).toBe(409);
    expect((await poll(resenha.inviteCode, ana.cookie, 'split')).tiedOptionIds).toHaveLength(3);

    const where = await poll(resenha.inviteCode, ana.cookie, 'where');
    expect((await closePoll(resenha.id, where.id, ana.cookie)).status).toBe(204);
    expect(await poll(resenha.inviteCode, ana.cookie, 'where')).toMatchObject({
      status: 'closed',
      winningOptionId: null,
      tiedOptionIds: [],
    });
  });

  it('onde vencedor vira o bairro; com tudo decidido, a resenha fica "decidida"', async () => {
    const { ana, resenha } = await scenario();
    const where = await poll(resenha.inviteCode, ana.cookie, 'where');
    await suggest(resenha.id, where.id, ana.cookie, 'Vila Madalena');
    const option = (await poll(resenha.inviteCode, ana.cookie, 'where')).options[0];
    await vote(resenha.id, where.id, ana.cookie, option?.id ?? '');
    await closePoll(resenha.id, where.id, ana.cookie);

    let page = await view(resenha.inviteCode, ana.cookie);
    expect(page.neighborhood).toBe('Vila Madalena');
    expect(page.status).toBe('open');

    const when = pollOf(page, 'when');
    const split = pollOf(page, 'split');
    await closePoll(resenha.id, when.id, ana.cookie); // sem opções
    await vote(resenha.id, split.id, ana.cookie, split.options[0]?.id ?? '');
    await closePoll(resenha.id, split.id, ana.cookie);

    page = await view(resenha.inviteCode, ana.cookie);
    expect(page.status).toBe('decided');
  });

  it('o prazo fecha a votação sozinho pelo alarme do Durable Object', async () => {
    const { ana, bia, resenha } = await scenario();
    const split = await poll(resenha.inviteCode, ana.cookie, 'split');
    await vote(resenha.id, split.id, bia.cookie, split.options[1]?.id ?? '');

    const deadline = (closesAt: string | null, cookie = ana.cookie) =>
      api(`/resenhas/${resenha.id}/polls/${split.id}/deadline`, { body: { closesAt }, cookie });
    expect((await deadline('2020-01-01T00:00:00Z')).status).toBe(400);
    expect(
      (await deadline(new Date(Date.now() + 3_600_000).toISOString(), bia.cookie)).status,
    ).toBe(404);
    expect((await deadline(new Date(Date.now() + 3_600_000).toISOString())).status).toBe(204);
    expect((await poll(resenha.inviteCode, ana.cookie, 'split')).closesAt).not.toBeNull();

    // Simula o prazo vencido e dispara o alarme
    await sql(`update polls set closes_at = now() - interval '1 second' where id = $1`, [split.id]);
    const stub = env.RESENHA_ROOM.get(env.RESENHA_ROOM.idFromName(resenha.id));
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    const after = await poll(resenha.inviteCode, ana.cookie, 'split');
    expect(after).toMatchObject({ status: 'closed', winningOptionId: split.options[1]?.id });
  });

  it('voto depois do prazo é recusado mesmo se o alarme ainda não rodou', async () => {
    const { ana, bia, resenha } = await scenario();
    const split = await poll(resenha.inviteCode, ana.cookie, 'split');
    await vote(resenha.id, split.id, bia.cookie, split.options[0]?.id ?? '');
    await sql(`update polls set closes_at = now() - interval '1 second' where id = $1`, [split.id]);
    expect((await vote(resenha.id, split.id, ana.cookie, split.options[1]?.id ?? '')).status).toBe(
      409,
    );
    expect(await poll(resenha.inviteCode, ana.cookie, 'split')).toMatchObject({
      status: 'closed',
      winningOptionId: split.options[0]?.id,
    });
  });
});
