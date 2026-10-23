// Helpers dos testes de resenha e votação
import type { ResenhaLive, ResenhaView } from '@resenha/shared';
import { todayIso } from '@resenha/shared';
import { exports } from 'cloudflare:workers';
import { addToGroup, api, captureConsole, createGroup, newUser } from './helpers';

export const tomorrow = () => {
  const date = new Date(`${todayIso()}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

export async function createResenha(
  cookie: string,
  groupId: string,
  body: Record<string, unknown> = {},
) {
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

export async function view(code: string, cookie?: string) {
  return (await api(`/resenhas/code/${code}`, cookie ? { cookie } : {})).json<ResenhaView>();
}

export function join(code: string, cookie: string, from?: string) {
  return api(`/resenhas/code/${code}/join`, { body: from ? { from } : {}, cookie });
}

export function rsvp(resenhaId: string, cookie: string, value: 'going' | 'maybe' | 'not_going') {
  return api(`/resenhas/${resenhaId}/rsvp`, { body: { rsvp: value }, cookie });
}

export function decide(resenhaId: string, cookie: string, userId: string, decision: string) {
  return api(`/resenhas/${resenhaId}/participants/${userId}/${decision}`, {
    method: 'POST',
    cookie,
  });
}

/** Grupo com organizadora (Ana) e uma amiga (Bia), e uma resenha criada pela Ana. */
export async function scenario(logs: ReturnType<typeof captureConsole>) {
  const ana = await newUser(logs, 'Ana');
  const bia = await newUser(logs, 'Bia');
  const { group } = await createGroup(ana.cookie);
  await addToGroup(ana, bia, group);
  const { resenha } = await createResenha(ana.cookie, group.id);
  return { ana, bia, group, resenha };
}

/** Abre o WebSocket da resenha e guarda as mensagens recebidas. */
export async function openLive(resenhaId: string, cookie: string) {
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
