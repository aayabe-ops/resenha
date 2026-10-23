/**
 * Descrição de um erro inesperado que pode ir para o log: só o tipo e o
 * código SQLSTATE do Postgres. Nunca a mensagem, os parâmetros da consulta
 * nem o `detail`, que podem conter dados pessoais (ADR 0007, condição 6).
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return 'erro desconhecido';
  const cause = error.cause as { code?: unknown } | undefined;
  const code =
    typeof cause?.code === 'string' && /^[0-9A-Z]{5}$/.test(cause.code) ? cause.code : '';
  return code ? `${error.name} ${code}` : error.name;
}
