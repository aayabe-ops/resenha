// Login por código no WhatsApp e cadastro (ACE-02, ACE-03, ACE-04).
import { loginCodes, sessions, users } from '@resenha/db';
import {
  isMinor,
  isUnderMinAge,
  registerBody,
  requestCodeBody,
  verifyCodeBody,
  type VerifyCodeResponse,
} from '@resenha/shared';
import { and, count, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppEnv } from '../lib/context';
import { hmac, randomLoginCode, safeEqual } from '../lib/crypto';
import { apiError, clientIp, readBody } from '../lib/http';
import { hashedClientIp, ipLimitReached, recordIpRequest } from '../lib/ip-limit';
import { createRegistrationToken, readRegistrationToken } from '../lib/registration';
import { clearSessionCookie, requireUser, startSession } from '../lib/session';
import { verifyTurnstile } from '../lib/turnstile';
import { sendLoginCode } from '../lib/whatsapp';

// Limites da spec (seção 3)
const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const CODES_PER_PHONE = 3;
const PHONE_WINDOW_MINUTES = 15;

const minutesAgo = (minutes: number) => sql`now() - make_interval(mins => ${minutes})`;
const minutesFromNow = (minutes: number) => sql`now() + make_interval(mins => ${minutes})`;

function codeHash(secret: string, phone: string, code: string) {
  return hmac(secret, `login:${phone}:${code}`);
}

export const auth = new Hono<AppEnv>();

// Pede o código. A idade vem antes de tudo: abaixo de 15 anos, recusa sem
// gravar nada, nem o celular (ACE-03).
auth.post('/code', async (c) => {
  const body = await readBody(c, requestCodeBody);
  if (!body) return apiError(c, 400, 'invalid_request');
  if (isUnderMinAge(body.birthDate)) return apiError(c, 403, 'under_age');

  const ip = clientIp(c);
  if (!(await verifyTurnstile(c.env, body.turnstileToken, ip))) {
    return apiError(c, 403, 'turnstile_failed');
  }

  const db = await c.var.db();
  const [locked] = await db
    .select({ id: loginCodes.id })
    .from(loginCodes)
    .where(and(eq(loginCodes.phoneE164, body.phone), gt(loginCodes.lockedUntil, sql`now()`)))
    .limit(1);
  if (locked) return apiError(c, 429, 'code_locked');

  const [phoneCount] = await db
    .select({ total: count() })
    .from(loginCodes)
    .where(
      and(
        eq(loginCodes.phoneE164, body.phone),
        gt(loginCodes.createdAt, minutesAgo(PHONE_WINDOW_MINUTES)),
      ),
    );
  if ((phoneCount?.total ?? 0) >= CODES_PER_PHONE) return apiError(c, 429, 'rate_limited');

  const ipHash = await hashedClientIp(c);
  if (await ipLimitReached(db, ipHash, 'login_code')) return apiError(c, 429, 'rate_limited');

  const code = randomLoginCode();
  await recordIpRequest(db, ipHash, 'login_code');
  await db.insert(loginCodes).values({
    phoneE164: body.phone,
    codeHash: await codeHash(c.env.AUTH_SECRET, body.phone, code),
    expiresAt: minutesFromNow(CODE_TTL_MINUTES),
  });
  await sendLoginCode(c.env, { phone: body.phone, code });

  return c.json({ status: 'sent' }, 202);
});

// Confere o código: 10 min de validade, 5 erros bloqueiam por 15 min (ACE-02).
auth.post('/verify', async (c) => {
  const body = await readBody(c, verifyCodeBody);
  if (!body) return apiError(c, 400, 'invalid_request');

  const db = await c.var.db();
  const [current] = await db
    .select({
      id: loginCodes.id,
      codeHash: loginCodes.codeHash,
      locked: sql<boolean>`coalesce(${loginCodes.lockedUntil} > now(), false)`,
    })
    .from(loginCodes)
    .where(
      and(
        eq(loginCodes.phoneE164, body.phone),
        or(gt(loginCodes.expiresAt, sql`now()`), gt(loginCodes.lockedUntil, sql`now()`)),
      ),
    )
    .orderBy(desc(loginCodes.createdAt))
    .limit(1);

  if (!current) return apiError(c, 400, 'invalid_code');
  if (current.locked) return apiError(c, 429, 'code_locked');

  const expected = await codeHash(c.env.AUTH_SECRET, body.phone, body.code);
  if (!safeEqual(expected, current.codeHash)) {
    // Conta a tentativa e bloqueia na mesma escrita
    const [updated] = await db
      .update(loginCodes)
      .set({
        attempts: sql`${loginCodes.attempts} + 1`,
        lockedUntil: sql`case when ${loginCodes.attempts} + 1 >= ${MAX_ATTEMPTS}
          then ${minutesFromNow(LOCK_MINUTES)} else ${loginCodes.lockedUntil} end`,
      })
      .where(eq(loginCodes.id, current.id))
      .returning({ attempts: loginCodes.attempts });
    return (updated?.attempts ?? 0) >= MAX_ATTEMPTS
      ? apiError(c, 429, 'code_locked')
      : apiError(c, 400, 'invalid_code');
  }

  await db.delete(loginCodes).where(eq(loginCodes.phoneE164, body.phone));

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.phoneE164, body.phone), isNull(users.deletedAt)))
    .limit(1);
  if (user) {
    await startSession(c, user.id);
    return c.json({ status: 'logged_in' } satisfies VerifyCodeResponse);
  }

  const registrationToken = await createRegistrationToken(c.env.AUTH_SECRET, body.phone);
  return c.json({ status: 'needs_registration', registrationToken } satisfies VerifyCodeResponse);
});

// Primeiro acesso de um celular confirmado: apelido e nascimento.
auth.post('/register', async (c) => {
  const body = await readBody(c, registerBody);
  if (!body) return apiError(c, 400, 'invalid_request');
  if (isUnderMinAge(body.birthDate)) return apiError(c, 403, 'under_age');

  const phone = await readRegistrationToken(c.env.AUTH_SECRET, body.registrationToken);
  if (!phone) return apiError(c, 401, 'invalid_registration');

  const db = await c.var.db();
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.phoneE164, phone), isNull(users.deletedAt)))
    .limit(1);

  let userId = existing?.id;
  if (!userId) {
    const [created] = await db
      .insert(users)
      .values({
        nickname: body.nickname,
        birthDate: body.birthDate,
        phoneE164: phone,
        phoneVerifiedAt: sql`now()`,
        // De 15 a 17 anos: conta de menor; o fluxo de consentimento depende do
        // parecer jurídico (questões em aberto #2 e #3)
        consentStatus: isMinor(body.birthDate) ? 'pending' : 'not_required',
      })
      .returning({ id: users.id });
    userId = created?.id;
  }
  if (!userId) return apiError(c, 500, 'internal');

  await startSession(c, userId);
  return c.json({ status: 'logged_in' } satisfies VerifyCodeResponse, existing ? 200 : 201);
});

auth.post('/logout', requireUser, async (c) => {
  const db = await c.var.db();
  await db
    .update(sessions)
    .set({ revokedAt: sql`now()` })
    .where(eq(sessions.id, c.var.user.sessionId));
  clearSessionCookie(c);
  return c.body(null, 204);
});
