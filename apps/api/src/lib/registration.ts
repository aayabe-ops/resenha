import { encodeBase64Url, fromBase64Url, hmac, safeEqual } from './crypto';

// Depois que o código é confirmado e o celular ainda não tem conta, a API
// devolve este token para o cadastro (apelido + nascimento). Vale 10 min.
const REGISTRATION_MS = 10 * 60 * 1000;

async function signature(secret: string, phone: string, expiresAt: number) {
  return hmac(secret, `registration:${phone}:${expiresAt}`);
}

export async function createRegistrationToken(secret: string, phone: string): Promise<string> {
  const expiresAt = Date.now() + REGISTRATION_MS;
  return `${encodeBase64Url(phone)}.${expiresAt}.${await signature(secret, phone, expiresAt)}`;
}

/** Devolve o celular confirmado, ou null se o token for inválido ou vencido. */
export async function readRegistrationToken(secret: string, token: string): Promise<string | null> {
  const [encodedPhone, expiresText, given] = token.split('.');
  if (!encodedPhone || !expiresText || !given) return null;
  const expiresAt = Number(expiresText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt < Date.now()) return null;
  let phone: string;
  try {
    phone = fromBase64Url(encodedPhone);
  } catch {
    return null;
  }
  return safeEqual(given, await signature(secret, phone, expiresAt)) ? phone : null;
}
