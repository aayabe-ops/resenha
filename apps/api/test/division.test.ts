import type { Poll, ResenhaView } from '@resenha/shared';
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { servePreview } from '../src/preview';
import {
  addToGroup,
  api,
  birthDateForAge,
  captureConsole,
  newUser,
  resetDatabase,
  sql,
} from './helpers';
import { decide, join, openLive, rsvp, scenario as scenarioWith, view } from './resenha-helpers';

let logs: ReturnType<typeof captureConsole>;

beforeEach(async () => {
  await resetDatabase();
  logs = captureConsole();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const ADDRESS = 'Rua das Flores, 123, apto 45';

function pollOf(page: ResenhaView, kind: Poll['kind']): Poll {
  const found = page.polls.find((item) => item.kind === kind);
  if (!found) throw new Error(`sem votação ${kind}`);
  return found;
}

const post = (path: string, cookie: string, body: unknown = {}) => api(path, { body, cookie });

async function closeWith(resenhaId: string, poll: Poll, cookie: string, optionId: string) {
  await post(`/resenhas/${resenhaId}/polls/${poll.id}/vote`, cookie, { optionId });
  return post(`/resenhas/${resenhaId}/polls/${poll.id}/close`, cookie);
}

/** Ana organiza; Bia (do grupo) entra, oferece a casa e a casa vence. */
async function withHome() {
  const base = await scenarioWith(logs);
  const { ana, bia, resenha } = base;
  await join(resenha.inviteCode, bia.cookie);
  expect(
    (await post(`/resenhas/${resenha.id}/home`, bia.cookie, { neighborhood: 'Pinheiros' })).status,
  ).toBe(204);
  const where = pollOf(await view(resenha.inviteCode, ana.cookie), 'where');
  const home = where.options[0];
  await closeWith(resenha.id, where, ana.cookie, home?.id ?? '');
  return base;
}

async function decideSplit(resenhaId: string, code: string, cookie: string, model: string) {
  const split = pollOf(await view(code, cookie), 'split');
  const option = split.options.find((item) => item.splitModel === model);
  return closeWith(resenhaId, split, cookie, option?.id ?? '');
}

describe('DIV-04: pode ser lá em casa', () => {
  it('a casa vira opção de onde mostrando só o bairro, sem citar a pessoa', async () => {
    const { ana, bia, resenha } = await scenarioWith(logs);
    await join(resenha.inviteCode, bia.cookie);
    await post(`/resenhas/${resenha.id}/home`, bia.cookie, { neighborhood: 'Pinheiros' });

    const where = pollOf(await view(resenha.inviteCode, ana.cookie), 'where');
    expect(where.options).toEqual([
      expect.objectContaining({
        label: 'Uma casa em Pinheiros',
        isHome: true,
        suggestedBy: { id: bia.id, nickname: 'Bia' },
      }),
    ]);
    expect(where.options[0]?.label).not.toContain('Bia');
    // Uma oferta por pessoa; o bairro passa pelo filtro de pessoas
    expect(
      (await post(`/resenhas/${resenha.id}/home`, bia.cookie, { neighborhood: 'Lapa' })).status,
    ).toBe(400);
    expect(
      (await post(`/resenhas/${resenha.id}/home`, ana.cookie, { neighborhood: 'Perto da Bia' }))
        .status,
    ).toBe(422);
    // Nenhum endereço é guardado na oferta
    const [row] = await sql<{ exact_address: string | null }>(
      'select exact_address from resenhas where id = $1',
      [resenha.id],
    );
    expect(row?.exact_address).toBeNull();
  });

  it('se a casa vence, quem ofereceu vira anfitrião e o bairro vai para a resenha', async () => {
    const { ana, bia, resenha } = await withHome();
    const page = await view(resenha.inviteCode, ana.cookie);
    expect(page.host).toEqual({ id: bia.id, nickname: 'Bia' });
    expect(page.neighborhood).toBe('Pinheiros');
    expect((await view(resenha.inviteCode, bia.cookie)).me?.isHost).toBe(true);
  });

  it('o anfitrião aprova e remove como o organizador; ninguém remove o anfitrião', async () => {
    const { ana, bia, resenha } = await withHome();
    const caio = await newUser(logs, 'Caio');
    await join(resenha.inviteCode, caio.cookie);
    expect((await view(resenha.inviteCode, bia.cookie)).requests.map((r) => r.id)).toEqual([
      caio.id,
    ]);
    expect((await decide(resenha.id, bia.cookie, caio.id, 'approve')).status).toBe(204);
    expect((await decide(resenha.id, bia.cookie, caio.id, 'remove')).status).toBe(204);
    expect((await decide(resenha.id, ana.cookie, bia.id, 'remove')).status).toBe(403);
    expect((await decide(resenha.id, bia.cookie, ana.id, 'remove')).status).toBe(403);
  });
});

describe('LOC-01 a LOC-04: endereço protegido', () => {
  it('só o anfitrião informa o endereço', async () => {
    const { ana, bia, resenha } = await withHome();
    expect(
      (await post(`/resenhas/${resenha.id}/address`, ana.cookie, { address: ADDRESS })).status,
    ).toBe(404);
    expect(
      (await post(`/resenhas/${resenha.id}/address`, bia.cookie, { address: ADDRESS })).status,
    ).toBe(204);
  });

  it('só aprovados com "Vou", organizador e anfitrião veem o endereço', async () => {
    const { ana, bia, group, resenha } = await withHome();
    await post(`/resenhas/${resenha.id}/address`, bia.cookie, { address: ADDRESS });
    const caio = await newUser(logs, 'Caio');
    await addToGroup(ana, caio, group);
    await join(resenha.inviteCode, caio.cookie);
    const fora = await newUser(logs, 'Fora');
    await join(resenha.inviteCode, fora.cookie); // pendente

    // LOC-01: sem sessão ou pendente, só o bairro
    const anonymous = await view(resenha.inviteCode);
    expect(anonymous.neighborhood).toBe('Pinheiros');
    expect(anonymous.exactAddress).toBeNull();
    expect((await view(resenha.inviteCode, fora.cookie)).exactAddress).toBeNull();

    // Aprovado sem "Vou" não vê; com "Vou" vê (LOC-02)
    expect((await view(resenha.inviteCode, caio.cookie)).exactAddress).toBeNull();
    await rsvp(resenha.id, caio.cookie, 'maybe');
    expect((await view(resenha.inviteCode, caio.cookie)).exactAddress).toBeNull();
    await rsvp(resenha.id, caio.cookie, 'going');
    expect((await view(resenha.inviteCode, caio.cookie)).exactAddress).toBe(ADDRESS);

    // Organizador e anfitrião veem mesmo sem "Vou"
    expect((await view(resenha.inviteCode, ana.cookie)).exactAddress).toBe(ADDRESS);
    expect((await view(resenha.inviteCode, bia.cookie)).exactAddress).toBe(ADDRESS);

    // Nenhuma resposta da API para quem não pode contém o endereço
    const raw = await (
      await api(`/resenhas/code/${resenha.inviteCode}`, { cookie: fora.cookie })
    ).text();
    expect(raw).not.toContain('Flores');
  });

  it('pelo WebSocket, o endereço só vai para quem pode', async () => {
    const { ana, bia, group, resenha } = await withHome();
    const caio = await newUser(logs, 'Caio');
    await addToGroup(ana, caio, group);
    await join(resenha.inviteCode, caio.cookie);
    const asCaio = await openLive(resenha.id, caio.cookie);
    if (!asCaio.ok) throw new Error('sem WebSocket');
    if (asCaio.messages.length === 0) await asCaio.next();

    const waiting = asCaio.next();
    await post(`/resenhas/${resenha.id}/address`, bia.cookie, { address: ADDRESS });
    await waiting;
    expect(asCaio.messages.at(-1)?.exactAddress).toBeNull();
    expect(JSON.stringify(asCaio.messages)).not.toContain('Flores');

    const afterRsvp = asCaio.next();
    await rsvp(resenha.id, caio.cookie, 'going');
    await afterRsvp;
    expect(asCaio.messages.at(-1)?.exactAddress).toBe(ADDRESS);
    asCaio.socket.close();
  });

  it('LOC-03: o Cron apaga o endereço 24 h depois do encerramento', async () => {
    const { ana, bia, resenha } = await withHome();
    await post(`/resenhas/${resenha.id}/address`, bia.cookie, { address: ADDRESS });
    await post(`/resenhas/${resenha.id}/close`, ana.cookie);

    const runCron = async () => {
      const ctx = createExecutionContext();
      await worker.scheduled(createScheduledController({ cron: '*/15 * * * *' }), env, ctx);
      await waitOnExecutionContext(ctx);
    };
    const address = async () =>
      (
        await sql<{ exact_address: string | null; purged: boolean }>(
          'select exact_address, address_purged_at is not null as purged from resenhas where id = $1',
          [resenha.id],
        )
      )[0];

    await runCron();
    expect(await address()).toEqual({ exact_address: ADDRESS, purged: false });

    await sql(`update resenhas set closed_at = now() - interval '25 hours' where id = $1`, [
      resenha.id,
    ]);
    await runCron();
    expect(await address()).toEqual({ exact_address: null, purged: true });
  });

  it('o endereço nunca vai para a prévia do link nem para o log', async () => {
    const { bia, resenha } = await withHome();
    await post(`/resenhas/${resenha.id}/address`, bia.cookie, { address: ADDRESS });
    const assets = {
      fetch: async () =>
        new Response('<html><head><title>x</title></head><body></body></html>', {
          headers: { 'Content-Type': 'text/html' },
        }),
    };
    const preview = await servePreview(new Request(`http://localhost/r/${resenha.inviteCode}`), {
      ...env,
      ASSETS: assets,
    } as unknown as typeof env);
    const html = await preview.text();
    expect(html).toContain('Pinheiros');
    expect(html).not.toContain('Flores');
    expect(logs.lines.join('\n')).not.toContain('Flores');
  });
});

describe('DIV-01 e DIV-03: quem leva o quê', () => {
  async function eachBrings() {
    const base = await scenarioWith(logs);
    await join(base.resenha.inviteCode, base.bia.cookie);
    await decideSplit(base.resenha.id, base.resenha.inviteCode, base.ana.cookie, 'each_brings');
    return base;
  }

  it('só existe quando "cada um leva" venceu', async () => {
    const base = await scenarioWith(logs);
    expect(
      (await post(`/resenhas/${base.resenha.id}/items`, base.ana.cookie, { description: 'Gelo' }))
        .status,
    ).toBe(403);
  });

  it('participantes criam e assumem itens; no máximo um responsável', async () => {
    const { ana, bia, resenha } = await eachBrings();
    await post(`/resenhas/${resenha.id}/items`, ana.cookie, { description: 'Gelo' });
    const [item] = (await view(resenha.inviteCode, ana.cookie)).items;
    expect(item).toMatchObject({ description: 'Gelo', owner: null, status: 'open' });

    expect((await post(`/resenhas/${resenha.id}/items/${item?.id}/claim`, bia.cookie)).status).toBe(
      204,
    );
    expect((await post(`/resenhas/${resenha.id}/items/${item?.id}/claim`, ana.cookie)).status).toBe(
      403,
    );
    expect((await view(resenha.inviteCode, ana.cookie)).items[0]?.owner).toEqual({
      id: bia.id,
      nickname: 'Bia',
    });

    // Só quem assumiu larga
    expect(
      (await post(`/resenhas/${resenha.id}/items/${item?.id}/release`, ana.cookie)).status,
    ).toBe(403);
    expect(
      (await post(`/resenhas/${resenha.id}/items/${item?.id}/release`, bia.cookie)).status,
    ).toBe(204);
    expect((await view(resenha.inviteCode, ana.cookie)).items[0]?.owner).toBeNull();
  });

  it('o responsável marca como garantido; sem responsável não dá', async () => {
    const { ana, bia, resenha } = await eachBrings();
    await post(`/resenhas/${resenha.id}/items`, ana.cookie, { description: 'Copos' });
    const [item] = (await view(resenha.inviteCode, ana.cookie)).items;
    expect(
      (await post(`/resenhas/${resenha.id}/items/${item?.id}/secure`, bia.cookie)).status,
    ).toBe(403);
    expect(
      (await post(`/resenhas/${resenha.id}/items/${item?.id}/secure`, ana.cookie)).status,
    ).toBe(400);
    await post(`/resenhas/${resenha.id}/items/${item?.id}/claim`, bia.cookie);
    expect(
      (await post(`/resenhas/${resenha.id}/items/${item?.id}/secure`, bia.cookie)).status,
    ).toBe(204);
    expect((await view(resenha.inviteCode, ana.cookie)).items[0]?.status).toBe('secured');
  });

  it('quem não participa não mexe nos itens', async () => {
    const { ana, resenha } = await eachBrings();
    await post(`/resenhas/${resenha.id}/items`, ana.cookie, { description: 'Gelo' });
    const fora = await newUser(logs, 'Fora');
    const [item] = (await view(resenha.inviteCode, ana.cookie)).items;
    expect(
      (await post(`/resenhas/${resenha.id}/items`, fora.cookie, { description: 'X' })).status,
    ).toBe(404);
    expect(
      (await post(`/resenhas/${resenha.id}/items/${item?.id}/claim`, fora.cookie)).status,
    ).toBe(404);
  });

  it('itens de álcool: livres sem menor; bloqueados e apagados quando um menor entra', async () => {
    const { ana, bia, group, resenha } = await eachBrings();
    await sql(
      `insert into blocked_terms (term, category) values ('cerveja', 'alcohol'), ('idiota', 'offensive')`,
    );
    expect(
      (await post(`/resenhas/${resenha.id}/items`, ana.cookie, { description: 'Idiota' })).status,
    ).toBe(422);
    expect(
      (await post(`/resenhas/${resenha.id}/items`, bia.cookie, { description: 'Cerveja' })).status,
    ).toBe(204);
    await post(`/resenhas/${resenha.id}/items`, bia.cookie, { description: 'Gelo' });

    const teen = await newUser(logs, 'Teca');
    await sql(`update users set birth_date = $1 where id = $2`, [birthDateForAge(16), teen.id]);
    await addToGroup(ana, teen, group);
    await join(resenha.inviteCode, teen.cookie);

    expect(
      (await view(resenha.inviteCode, ana.cookie)).items.map((item) => item.description),
    ).toEqual(['Gelo']);
    expect(
      (await post(`/resenhas/${resenha.id}/items`, bia.cookie, { description: 'Mais CERVÉJA' }))
        .status,
    ).toBe(422);
  });
});

describe('DIV-02: rateio', () => {
  it('valor por pessoa = total ÷ quem vai, para cima no centavo, recalculado a cada confirmação', async () => {
    const { ana, bia, group, resenha } = await scenarioWith(logs);
    await join(resenha.inviteCode, bia.cookie);
    await decideSplit(resenha.id, resenha.inviteCode, ana.cookie, 'equal_split');

    expect(
      (await post(`/resenhas/${resenha.id}/total`, bia.cookie, { totalCostCents: 10000 })).status,
    ).toBe(404);
    expect(
      (await post(`/resenhas/${resenha.id}/total`, ana.cookie, { totalCostCents: 10000 })).status,
    ).toBe(204);
    let page = await view(resenha.inviteCode, bia.cookie);
    expect(page).toMatchObject({ totalCostCents: 10000, perPersonCents: null });

    await rsvp(resenha.id, ana.cookie, 'going');
    await rsvp(resenha.id, bia.cookie, 'going');
    const caio = await newUser(logs, 'Caio');
    await addToGroup(ana, caio, group);
    await join(resenha.inviteCode, caio.cookie);
    await rsvp(resenha.id, caio.cookie, 'going');
    page = await view(resenha.inviteCode, bia.cookie);
    expect(page.perPersonCents).toBe(3334); // R$ 100 ÷ 3 = 33,333… → 33,34

    await rsvp(resenha.id, caio.cookie, 'not_going');
    expect((await view(resenha.inviteCode, bia.cookie)).perPersonCents).toBe(5000);
  });

  it('só existe com "rateio igual"', async () => {
    const { ana, resenha } = await scenarioWith(logs);
    await decideSplit(resenha.id, resenha.inviteCode, ana.cookie, 'each_brings');
    expect(
      (await post(`/resenhas/${resenha.id}/total`, ana.cookie, { totalCostCents: 100 })).status,
    ).toBe(403);
  });
});
