/** AAAA-MM-DD por extenso ("sábado, 25 de outubro"). */
export function formatLongDate(isoDate: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

/** AAAA-MM-DD para o formato brasileiro, sem depender do fuso do aparelho. */
export function formatDate(isoDate: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );
}
