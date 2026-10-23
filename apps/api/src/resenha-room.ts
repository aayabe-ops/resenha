// Durable Object da resenha (ADR 0001; spec, seção 2): um por resenha. Grava
// no Postgres cada mudança de participação e avisa ao vivo, pelo WebSocket,
// quem está com a página aberta (RES-03, RES-04, RNF-02). Não guarda estado
// próprio: se reiniciar, tudo vem do banco. As permissões são checadas aqui,
// com o id do usuário autenticado pelo Worker.
import { connect, type Database } from '@resenha/db/client';
import { groupMembers, participations, resenhas } from '@resenha/db';
import type { AccessStatus, ResenhaLive, Rsvp } from '@resenha/shared';
import { and, eq, sql } from 'drizzle-orm';
import { DurableObject } from 'cloudflare:workers';
import type { Bindings } from './lib/context';
import { loadLive } from './lib/resenha-state';

export type JoinResult = AccessStatus | 'not_found' | 'closed' | 'forbidden';
export type ActionResult = 'ok' | 'not_found' | 'closed' | 'forbidden';
export type Decision = 'approve' | 'reject' | 'remove';

// Código de fechamento para quem perdeu o acesso (RES-06)
export const REMOVED_CLOSE_CODE = 4403;

const ORGANIZER_TAG = 'organizer';

export class ResenhaRoom extends DurableObject<Bindings> {
  private async withDb<T>(work: (db: Database) => Promise<T>): Promise<T> {
    const { db, close } = await connect(this.env.HYPERDRIVE.connectionString);
    try {
      return await work(db);
    } finally {
      await close();
    }
  }

  /** Conexão WebSocket, encaminhada pelo Worker depois de checar a sessão. */
  override async fetch(request: Request): Promise<Response> {
    const userId = request.headers.get('X-Resenha-User');
    const resenhaId = request.headers.get('X-Resenha-Id');
    if (!userId || !resenhaId) return new Response(null, { status: 400 });
    const isOrganizer = request.headers.get('X-Resenha-Role') === ORGANIZER_TAG;

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, isOrganizer ? [userId, ORGANIZER_TAG] : [userId]);
    const live = await this.withDb((db) => loadLive(db, resenhaId));
    server.send(JSON.stringify(this.viewFor(live, isOrganizer)));
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage() {
    // O cliente só escuta; as mudanças chegam pelas rotas HTTP.
  }

  override async webSocketClose(ws: WebSocket, code: number) {
    ws.close(code === 1005 ? 1000 : code);
  }

  private viewFor(live: ResenhaLive, isOrganizer: boolean): ResenhaLive {
    return {
      status: live.status,
      counts: live.counts,
      participants: live.participants,
      requests: isOrganizer ? live.requests : [],
    };
  }

  private async broadcast(db: Database, resenhaId: string) {
    const live = await loadLive(db, resenhaId);
    for (const ws of this.ctx.getWebSockets()) {
      const isOrganizer = this.ctx.getTags(ws).includes(ORGANIZER_TAG);
      try {
        ws.send(JSON.stringify(this.viewFor(live, isOrganizer)));
      } catch {
        // conexão já fechada
      }
    }
  }

  private disconnect(userId: string) {
    for (const ws of this.ctx.getWebSockets(userId)) {
      ws.close(REMOVED_CLOSE_CODE, 'removed');
    }
  }

  /** Entrada pelo link: quem é do grupo entra direto; quem é de fora fica pendente. */
  async join(resenhaId: string, userId: string, from: string | null): Promise<JoinResult> {
    return this.withDb(async (db) => {
      const [resenha] = await db
        .select({ groupId: resenhas.groupId, status: resenhas.status })
        .from(resenhas)
        .where(eq(resenhas.id, resenhaId));
      if (!resenha) return 'not_found';

      const [current] = await db
        .select({ access: participations.access })
        .from(participations)
        .where(and(eq(participations.resenhaId, resenhaId), eq(participations.userId, userId)));
      if (current) {
        return current.access === 'rejected' || current.access === 'removed'
          ? 'forbidden'
          : current.access;
      }
      if (resenha.status === 'closed') return 'closed';

      const [member] = await db
        .select({ userId: groupMembers.userId })
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupId, resenha.groupId),
            eq(groupMembers.userId, userId),
            eq(groupMembers.status, 'approved'),
          ),
        );

      // "De qual link veio" (RES-05): só vale se quem compartilhou participa
      let invitedBy: string | null = null;
      if (from && from !== userId) {
        const [inviter] = await db
          .select({ userId: participations.userId })
          .from(participations)
          .where(
            and(
              eq(participations.resenhaId, resenhaId),
              eq(participations.userId, from),
              eq(participations.access, 'approved'),
            ),
          );
        invitedBy = inviter ? from : null;
      }

      const access = member ? 'approved' : 'pending';
      await db
        .insert(participations)
        .values({
          resenhaId,
          userId,
          access,
          inviteSource: member ? 'group_link' : 'resenha_link',
          invitedBy,
        })
        .onConflictDoNothing();
      await this.broadcast(db, resenhaId);
      return access;
    });
  }

  /** Vou / Talvez / Não vou, trocável enquanto a resenha não encerra (RES-03). */
  async setRsvp(resenhaId: string, userId: string, rsvp: Rsvp): Promise<ActionResult> {
    return this.withDb(async (db) => {
      const [resenha] = await db
        .select({ status: resenhas.status })
        .from(resenhas)
        .where(eq(resenhas.id, resenhaId));
      if (!resenha) return 'not_found';
      if (resenha.status === 'closed') return 'closed';

      const updated = await db
        .update(participations)
        .set({ rsvp, updatedAt: sql`now()` })
        .where(
          and(
            eq(participations.resenhaId, resenhaId),
            eq(participations.userId, userId),
            eq(participations.access, 'approved'),
          ),
        )
        .returning({ userId: participations.userId });
      if (updated.length === 0) return 'forbidden';
      await this.broadcast(db, resenhaId);
      return 'ok';
    });
  }

  /** Organizador aprova ou recusa pedidos e remove participantes (RES-05, RES-06). */
  async decide(
    resenhaId: string,
    actorId: string,
    targetId: string,
    decision: Decision,
  ): Promise<ActionResult> {
    return this.withDb(async (db) => {
      const [resenha] = await db
        .select({ status: resenhas.status, organizerId: resenhas.organizerId })
        .from(resenhas)
        .where(eq(resenhas.id, resenhaId));
      if (!resenha || resenha.organizerId !== actorId) return 'not_found';
      if (resenha.status === 'closed') return 'closed';
      if (targetId === resenha.organizerId) return 'forbidden';

      const from: AccessStatus = decision === 'remove' ? 'approved' : 'pending';
      const to: AccessStatus =
        decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'removed';
      const updated = await db
        .update(participations)
        .set({ access: to, decidedBy: actorId, updatedAt: sql`now()` })
        .where(
          and(
            eq(participations.resenhaId, resenhaId),
            eq(participations.userId, targetId),
            eq(participations.access, from),
          ),
        )
        .returning({ userId: participations.userId });
      if (updated.length === 0) return 'not_found';

      // Perde o acesso na hora, sem aviso público (RES-06)
      if (decision === 'remove') this.disconnect(targetId);
      await this.broadcast(db, resenhaId);
      return 'ok';
    });
  }

  /** Encerrar: sai das ativas e vira histórico (RES-07). */
  async close(resenhaId: string, actorId: string): Promise<ActionResult> {
    return this.withDb(async (db) => {
      const updated = await db
        .update(resenhas)
        .set({ status: 'closed', closedAt: sql`now()`, updatedAt: sql`now()` })
        .where(
          and(
            eq(resenhas.id, resenhaId),
            eq(resenhas.organizerId, actorId),
            sql`${resenhas.status} <> 'closed'`,
          ),
        )
        .returning({ id: resenhas.id });
      if (updated.length === 0) return 'not_found';
      await this.broadcast(db, resenhaId);
      return 'ok';
    });
  }
}
