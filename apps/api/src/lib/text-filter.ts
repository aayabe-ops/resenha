// Filtro de texto das opções de voto (VOT-03, VOT-07). Termos bloqueados vêm
// da tabela blocked_terms (lista em aberto, questão #8). Opção sobre pessoa:
// apelido de alguém da resenha ou do grupo, como palavra inteira, ou "@".
import type { Database } from '@resenha/db/client';
import { blockedTerms, groupMembers, participations, resenhas, users } from '@resenha/db';
import { and, eq, or } from 'drizzle-orm';

type Queryable = Pick<Database, 'select' | 'selectDistinct'>;

/** Minúsculas, sem acento e só letras, números e espaços. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();
}

/** `phrase` aparece em `text` como palavra(s) inteira(s)? Ambos normalizados. */
export function containsWords(text: string, phrase: string): boolean {
  if (!phrase) return false;
  return ` ${text} `.includes(` ${phrase} `);
}

/**
 * Termos ofensivos sempre; termos de álcool só quando há menor aprovado na
 * resenha (sem álcool para menores; spec, seção 3).
 */
export async function isBlockedText(
  db: Queryable,
  text: string,
  { alcohol }: { alcohol: boolean },
): Promise<boolean> {
  const normalized = normalize(text);
  const terms = await db
    .select({ term: blockedTerms.term })
    .from(blockedTerms)
    .where(
      and(
        eq(blockedTerms.active, true),
        alcohol ? undefined : eq(blockedTerms.category, 'offensive'),
      ),
    );
  return terms.some(({ term }) => containsWords(normalized, normalize(term)));
}

/** VOT-07: a opção cita alguém da resenha ou do grupo? */
export async function mentionsPerson(
  db: Queryable,
  resenhaId: string,
  text: string,
): Promise<boolean> {
  if (text.includes('@')) return true;
  const [resenha] = await db
    .select({ groupId: resenhas.groupId })
    .from(resenhas)
    .where(eq(resenhas.id, resenhaId));
  if (!resenha) return false;

  const people = await db
    .selectDistinct({ nickname: users.nickname })
    .from(users)
    .leftJoin(
      participations,
      and(eq(participations.userId, users.id), eq(participations.resenhaId, resenhaId)),
    )
    .leftJoin(
      groupMembers,
      and(eq(groupMembers.userId, users.id), eq(groupMembers.groupId, resenha.groupId)),
    )
    .where(or(eq(participations.access, 'approved'), eq(groupMembers.status, 'approved')));

  const normalized = normalize(text);
  return people.some(({ nickname }) => containsWords(normalized, normalize(nickname)));
}
