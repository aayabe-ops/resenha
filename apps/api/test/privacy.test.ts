import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeError } from '../src/lib/errors';
import { api, birthDateForAge, captureConsole, registerUser, resetDatabase } from './helpers';

beforeEach(async () => {
  await resetDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('nenhum dado pessoal em log (CLAUDE.md)', () => {
  it('o fluxo de acesso inteiro não registra celular, nascimento nem IP', async () => {
    const logs = captureConsole();
    const phone = '+5511987654321';
    const birthDate = birthDateForAge(16);

    const cookie = await registerUser(logs, { phone, birthDate, nickname: 'Teca' });
    await api('/me', { cookie });
    await api('/auth/code', {
      body: { phone, birthDate: birthDateForAge(14), turnstileToken: 'x' },
    });
    await api('/auth/verify', { body: { phone, code: '000000' } });
    await api('/guests', { body: { nickname: 'Visita', birthDate } });
    await api('/me', { method: 'DELETE', cookie });

    const output = logs.lines.join('\n');
    expect(output).not.toContain('987654321');
    expect(output).not.toContain(birthDate);
    expect(output).not.toContain('203.0.113.10');
    // O que aparece no modo dev é só o código, sem o celular
    expect(
      logs.lines.every((line) => !line.includes('[whatsapp:dev]') || /: \d{6}$/.test(line)),
    ).toBe(true);
  });

  it('erro inesperado vira só tipo e SQLSTATE, sem mensagem, parâmetros ou detail', () => {
    const phone = '+5511912345678';
    const cause = Object.assign(new Error(`duplicate key value (${phone})`), {
      code: '23505',
      detail: `Key (phone_e164)=(${phone}) already exists.`,
    });
    const error = new Error(`Failed query: insert into users ... params: ${phone}`, { cause });
    error.name = 'DrizzleQueryError';

    const described = describeError(error);
    expect(described).toBe('DrizzleQueryError 23505');
    expect(described).not.toContain('912345678');
  });
});
