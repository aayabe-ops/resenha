import type { HealthResponse } from '@resenha/shared';
import { Hono } from 'hono';
import { cleanupExpired } from './cleanup';
import type { AppEnv, Bindings } from './lib/context';
import { withDb } from './lib/db';
import { describeError } from './lib/errors';
import { apiError } from './lib/http';
import { account } from './routes/account';
import { auth } from './routes/auth';
import { groupRoutes } from './routes/groups';
import { resenhaRoutes } from './routes/resenhas';
import { servePreview } from './preview';

const app = new Hono<AppEnv>().basePath('/api');

app.get('/health', (c) => c.json({ status: 'ok' } satisfies HealthResponse));

app.use(withDb);
app.route('/auth', auth);
app.route('/', account);
app.route('/', groupRoutes);
app.route('/', resenhaRoutes);

// Nunca registrar mensagem, corpo ou parâmetros: podem ter dados pessoais
// (CLAUDE.md; ADR 0007, condição 6). Só o tipo e o código SQLSTATE.
app.onError((error, c) => {
  console.error('erro não tratado', describeError(error));
  return apiError(c, 500, 'internal');
});

export { ResenhaRoom } from './resenha-room';

export default {
  fetch(request, env, ctx) {
    if (new URL(request.url).pathname.startsWith('/r/')) return servePreview(request, env);
    return app.fetch(request, env, ctx);
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(cleanupExpired(env));
  },
} satisfies ExportedHandler<Bindings>;
