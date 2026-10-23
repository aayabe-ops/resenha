/** AAAA-MM-DD para o formato brasileiro, sem depender do fuso do aparelho. */
export function formatDate(isoDate: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );
}
