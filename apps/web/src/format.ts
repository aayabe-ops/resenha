/** AAAA-MM-DD por extenso ("sábado, 25 de outubro"). */
export function formatLongDate(isoDate: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

/** Hora local (fuso de São Paulo) de um instante ISO, como "21:30". */
export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** Data e hora curtas de um instante ISO, no fuso de São Paulo. */
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** AAAA-MM-DD para o formato brasileiro, sem depender do fuso do aparelho. */
export function formatDate(isoDate: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );
}
