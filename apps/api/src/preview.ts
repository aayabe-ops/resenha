// Prévia do link da resenha (RES-02, RNF-04): o Worker coloca título e
// descrição Open Graph no HTML do PWA. Só nome, dia e bairro; nunca o
// endereço. Também pede para buscadores não indexarem (nada encontrável por
// busca, CLAUDE.md).
import { resenhas } from '@resenha/db';
import { connect } from '@resenha/db/client';
import { eq } from 'drizzle-orm';
import type { Bindings } from './lib/context';

export interface PreviewData {
  name: string | null;
  date: string;
  neighborhood: string | null;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function previewText(data: PreviewData): { title: string; description: string } {
  const day = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${data.date}T00:00:00Z`));
  return {
    title: data.name ?? 'Resenha', // TODO(copy): revisar
    description: data.neighborhood ? `${day} · ${data.neighborhood}` : day,
  };
}

export function previewTags(data: PreviewData): string {
  const { title, description } = previewText(data);
  return [
    `<meta property="og:title" content="${escapeAttribute(title)}" />`,
    `<meta property="og:description" content="${escapeAttribute(description)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta name="robots" content="noindex, nofollow" />`,
  ].join('');
}

/** Serve /r/<código>: o mesmo PWA, com a prévia no <head>. */
export async function servePreview(request: Request, env: Bindings): Promise<Response> {
  const page = await env.ASSETS.fetch(new URL('/', request.url));
  const code = new URL(request.url).pathname.split('/')[2] ?? '';
  if (!page.ok || !/^[A-Za-z0-9_-]{22}$/.test(code)) return page;

  const { db, close } = await connect(env.HYPERDRIVE.connectionString);
  let data: PreviewData | undefined;
  try {
    [data] = await db
      .select({ name: resenhas.name, date: resenhas.date, neighborhood: resenhas.neighborhood })
      .from(resenhas)
      .where(eq(resenhas.inviteCode, code));
  } finally {
    await close();
  }
  if (!data) return page;

  const preview = data;
  return new HTMLRewriter()
    .on('title', {
      element(element) {
        element.setInnerContent(previewText(preview).title);
      },
    })
    .on('head', {
      element(element) {
        element.append(previewTags(preview), { html: true });
      },
    })
    .transform(page);
}
