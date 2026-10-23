import type { ApiErrorCode } from '@resenha/shared';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';

export function apiError(c: Context, status: ContentfulStatusCode, error: ApiErrorCode) {
  return c.json({ error }, status);
}

/** Lê e valida o corpo JSON; devolve null se for inválido. */
export async function readBody<T extends z.ZodType>(c: Context, schema: T) {
  const body: unknown = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  return parsed.success ? (parsed.data as z.infer<T>) : null;
}

/** IP de quem chama, como o Cloudflare informa. */
export function clientIp(c: Context): string {
  return c.req.header('CF-Connecting-IP') ?? 'unknown';
}
