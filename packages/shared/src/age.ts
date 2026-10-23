// Regras de idade (ACE-03, ACE-04). A idade é sempre calculada a partir da
// data de nascimento no momento da consulta, nunca guardada.

export const MIN_AGE = 15;
export const ADULT_AGE = 18;

const TIME_ZONE = 'America/Sao_Paulo';

/** Data de hoje (AAAA-MM-DD) no fuso de São Paulo. */
export function todayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(now);
}

function parts(isoDate: string): [number, number, number] {
  const [year, month, day] = isoDate.split('-').map(Number);
  return [year ?? 0, month ?? 0, day ?? 0];
}

/** Idade completa em anos numa data de referência (ambas AAAA-MM-DD). */
export function ageOn(birthDate: string, onDate: string): number {
  const [by, bm, bd] = parts(birthDate);
  const [y, m, d] = parts(onDate);
  const hadBirthday = m > bm || (m === bm && d >= bd);
  return y - by - (hadBirthday ? 0 : 1);
}

export function isUnderMinAge(birthDate: string, today: string = todayIso()): boolean {
  return ageOn(birthDate, today) < MIN_AGE;
}

export function isMinor(birthDate: string, today: string = todayIso()): boolean {
  return ageOn(birthDate, today) < ADULT_AGE;
}

/**
 * Data de nascimento neutra para a exclusão de conta (ACE-06): mantém só a
 * faixa. Menor fica com 31/12 do ano de nascimento, para nunca passar a
 * contar como maior antes da hora; maior fica com 01/01/1900.
 */
export function neutralBirthDate(birthDate: string, today: string = todayIso()): string {
  if (!isMinor(birthDate, today)) return '1900-01-01';
  return `${parts(birthDate)[0]}-12-31`;
}
