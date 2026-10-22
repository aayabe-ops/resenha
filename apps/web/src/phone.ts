/** Converte o que a pessoa digitou para E.164; sem "+", assume Brasil (+55). */
export function toE164(input: string): string {
  const digits = input.replace(/\D/g, '');
  return input.trim().startsWith('+') ? `+${digits}` : `+55${digits}`;
}
