import type {
  ApiErrorCode,
  GroupDetail,
  GroupHistoryItem,
  GroupSummary,
  InviteInfo,
  Me,
  MembershipStatus,
  PollKind,
  ResenhaSummary,
  ResenhaView,
  Rsvp,
  VerifyCodeResponse,
} from '@resenha/shared';

export class ApiFailure extends Error {
  constructor(public readonly code: ApiErrorCode) {
    super(code);
  }
}

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: init.body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: init.body === undefined ? null : JSON.stringify(init.body),
    credentials: 'same-origin',
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: ApiErrorCode } | null;
    throw new ApiFailure(data?.error ?? 'internal');
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export const api = {
  me: () => call<Me>('/me'),
  // TODO(turnstile): o widget entra com a hospedagem; no modo dev a API não verifica
  requestCode: (phone: string, birthDate: string) =>
    call('/auth/code', { body: { phone, birthDate, turnstileToken: 'dev' } }),
  verifyCode: (phone: string, code: string) =>
    call<VerifyCodeResponse>('/auth/verify', { body: { phone, code } }),
  register: (registrationToken: string, nickname: string, birthDate: string) =>
    call('/auth/register', { body: { registrationToken, nickname, birthDate } }),
  logout: () => call('/auth/logout', { method: 'POST' }),
  deleteAccount: () => call('/me', { method: 'DELETE' }),
  listGroups: () => call<GroupSummary[]>('/groups'),
  createGroup: (name: string) =>
    call<{ id: string; name: string; inviteCode: string }>('/groups', { body: { name } }),
  getGroup: (id: string) => call<GroupDetail>(`/groups/${encodeURIComponent(id)}`),
  groupHistory: (id: string) =>
    call<GroupHistoryItem[]>(`/groups/${encodeURIComponent(id)}/history`),
  getInvite: (code: string) => call<InviteInfo>(`/invites/${encodeURIComponent(code)}`),
  joinInvite: (code: string) =>
    call<{ status: MembershipStatus }>(`/invites/${encodeURIComponent(code)}/join`, {
      method: 'POST',
    }),
  approveMember: (groupId: string, userId: string) =>
    call(`/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}/approve`, {
      method: 'POST',
    }),
  createGuest: (nickname: string, birthDate: string) =>
    call('/guests', { body: { nickname, birthDate } }),
  listResenhas: (groupId: string) =>
    call<ResenhaSummary[]>(`/groups/${encodeURIComponent(groupId)}/resenhas`),
  // TODO(turnstile): o widget entra com a hospedagem; no modo dev a API não verifica
  createResenha: (
    groupId: string,
    input: { name: string | null; date: string; polls: PollKind[] },
  ) =>
    call<{ id: string; inviteCode: string }>(`/groups/${encodeURIComponent(groupId)}/resenhas`, {
      body: { ...input, turnstileToken: 'dev' },
    }),
  getResenha: (code: string) => call<ResenhaView>(`/resenhas/code/${encodeURIComponent(code)}`),
  joinResenha: (code: string, from: string | null) =>
    call<{ access: string }>(`/resenhas/code/${encodeURIComponent(code)}/join`, {
      body: from ? { from } : {},
    }),
  rsvp: (resenhaId: string, rsvp: Rsvp) =>
    call(`/resenhas/${encodeURIComponent(resenhaId)}/rsvp`, { body: { rsvp } }),
  decide: (resenhaId: string, userId: string, decision: 'approve' | 'reject' | 'remove') =>
    call(
      `/resenhas/${encodeURIComponent(resenhaId)}/participants/${encodeURIComponent(userId)}/${decision}`,
      { method: 'POST' },
    ),
  suggestOption: (resenhaId: string, pollId: string, label: string) =>
    call(`/resenhas/${encodeURIComponent(resenhaId)}/polls/${encodeURIComponent(pollId)}/options`, {
      body: { label },
    }),
  vote: (resenhaId: string, pollId: string, optionId: string) =>
    call(`/resenhas/${encodeURIComponent(resenhaId)}/polls/${encodeURIComponent(pollId)}/vote`, {
      body: { optionId },
    }),
  closePoll: (resenhaId: string, pollId: string, optionId?: string) =>
    call(`/resenhas/${encodeURIComponent(resenhaId)}/polls/${encodeURIComponent(pollId)}/close`, {
      body: optionId ? { optionId } : {},
    }),
  setDeadline: (resenhaId: string, pollId: string, closesAt: string | null) =>
    call(
      `/resenhas/${encodeURIComponent(resenhaId)}/polls/${encodeURIComponent(pollId)}/deadline`,
      {
        body: { closesAt },
      },
    ),
  setSuggestions: (resenhaId: string, allow: boolean) =>
    call(`/resenhas/${encodeURIComponent(resenhaId)}/suggestions`, { body: { allow } }),
  closeResenha: (resenhaId: string) =>
    call(`/resenhas/${encodeURIComponent(resenhaId)}/close`, { method: 'POST' }),
  removeMember: (groupId: string, userId: string) =>
    call(`/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}/remove`, {
      method: 'POST',
    }),
};

// TODO(copy): revisar todas as mensagens de erro
const messages: Record<ApiErrorCode, string> = {
  invalid_request: 'Confere os dados e tenta de novo.',
  under_age: 'A Resenha é só para quem tem 15 anos ou mais.',
  turnstile_failed: 'Não deu para confirmar que você não é um robô. Tenta de novo.',
  rate_limited: 'Muitos códigos pedidos. Espera um pouco e tenta de novo.',
  code_locked: 'Muitas tentativas erradas. Espera 15 minutos e pede um código novo.',
  invalid_code: 'Código errado ou vencido.',
  invalid_registration: 'Seu código venceu. Começa de novo.',
  unauthorized: 'Sua sessão acabou. Entra de novo.',
  not_found: 'Não encontrado.',
  forbidden: 'Você não pode fazer isso.',
  phone_required: 'Para isso, entra com seu celular.',
  group_full: 'O grupo já tem 200 pessoas.',
  resenha_closed: 'Essa resenha já foi encerrada.',
  poll_closed: 'Essa votação já fechou.',
  blocked_text: 'Essa opção não rola. Opções são sobre a resenha, nunca sobre pessoas.',
  tie: 'Deu empate. Escolhe qual opção vence.',
  internal: 'Deu ruim aqui. Tenta de novo daqui a pouco.',
};

export function errorMessage(error: unknown): string {
  return messages[error instanceof ApiFailure ? error.code : 'internal'];
}
