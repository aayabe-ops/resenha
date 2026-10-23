import type { ApiErrorCode, Me, VerifyCodeResponse } from '@resenha/shared';

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
  internal: 'Deu ruim aqui. Tenta de novo daqui a pouco.',
};

export function errorMessage(error: unknown): string {
  return messages[error instanceof ApiFailure ? error.code : 'internal'];
}
