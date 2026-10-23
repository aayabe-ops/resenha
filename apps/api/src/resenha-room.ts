// Durable Object da resenha (ADR 0001; spec, seção 2): um por resenha. Grava
// no Postgres cada mudança de participação e de votação e avisa ao vivo, pelo
// WebSocket, quem está com a página aberta (RES-03, RES-04, VOT-04, RNF-02).
// Não guarda estado próprio: se reiniciar, tudo vem do banco (o storage só
// guarda o id da resenha para o alarme do prazo). As permissões são checadas
// aqui, com o id do usuário autenticado pelo Worker.
import { connect, type Database } from '@resenha/db/client';
import {
  groupMembers,
  items,
  participations,
  pollOptions,
  polls,
  resenhas,
  votes,
} from '@resenha/db';
import { timeLabelSchema, type AccessStatus, type Rsvp } from '@resenha/shared';
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { DurableObject } from 'cloudflare:workers';
import type { Bindings } from './lib/context';
import {
  applyMinorRule,
  applyWinner,
  hasApprovedMinor,
  homeLabel,
  leaders,
  loadPolls,
  markDecidedIfDone,
} from './lib/polls';
import { isManager, liveFor, loadLive } from './lib/resenha-state';
import { isBlockedText, mentionsPerson } from './lib/text-filter';

export type JoinResult = AccessStatus | 'not_found' | 'closed' | 'forbidden';
export type ActionResult =
  'ok' | 'not_found' | 'closed' | 'forbidden' | 'poll_closed' | 'blocked' | 'invalid' | 'tie';
export type Decision = 'approve' | 'reject' | 'remove';

// Código de fechamento para quem perdeu o acesso (RES-06)
export const REMOVED_CLOSE_CODE = 4403;

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

    const { 0: client, 1: server } = new WebSocketPair();
    // O papel (organizador, anfitrião, quem vai) é calculado a cada envio
    this.ctx.acceptWebSocket(server, [userId]);
    const state = await this.withDb((db) => loadLive(db, resenhaId));
    server.send(JSON.stringify(liveFor(state, userId)));
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage() {
    // O cliente só escuta; as mudanças chegam pelas rotas HTTP.
  }

  override async webSocketClose(ws: WebSocket, code: number) {
    ws.close(code === 1005 ? 1000 : code);
  }

  private async broadcast(db: Database, resenhaId: string) {
    const state = await loadLive(db, resenhaId);
    for (const ws of this.ctx.getWebSockets()) {
      const [userId] = this.ctx.getTags(ws);
      if (!userId) continue;
      try {
        ws.send(JSON.stringify(liveFor(state, userId)));
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
      if (access === 'approved') await applyMinorRule(db, resenhaId);
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
        .select({
          status: resenhas.status,
          organizerId: resenhas.organizerId,
          hostId: resenhas.hostId,
        })
        .from(resenhas)
        .where(eq(resenhas.id, resenhaId));
      // Organizador e anfitrião gerenciam (spec, seção 3)
      if (!resenha || !isManager(resenha, actorId)) return 'not_found';
      if (resenha.status === 'closed') return 'closed';
      if (isManager(resenha, targetId)) return 'forbidden';

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
      if (decision === 'approve') await applyMinorRule(db, resenhaId);
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

  /** Contexto comum das ações de votação: resenha, votação e quem age. */
  private async pollContext(db: Database, resenhaId: string, pollId: string, actorId: string) {
    const [row] = await db
      .select({
        resenhaStatus: resenhas.status,
        organizerId: resenhas.organizerId,
        allowSuggestions: resenhas.allowSuggestions,
        pollStatus: polls.status,
        kind: polls.kind,
        expired: sql<boolean>`coalesce(${polls.closesAt} <= now(), false)`,
        access: participations.access,
      })
      .from(polls)
      .innerJoin(resenhas, eq(resenhas.id, polls.resenhaId))
      .leftJoin(
        participations,
        and(eq(participations.resenhaId, resenhas.id), eq(participations.userId, actorId)),
      )
      .where(and(eq(polls.id, pollId), eq(polls.resenhaId, resenhaId)));
    return row ?? null;
  }

  /** Sugestão de opção (VOT-03, VOT-07). O organizador sempre pode. */
  async addOption(
    resenhaId: string,
    actorId: string,
    pollId: string,
    label: string,
  ): Promise<ActionResult> {
    return this.withDb(async (db) => {
      const context = await this.pollContext(db, resenhaId, pollId, actorId);
      if (!context || context.access !== 'approved') return 'not_found';
      if (context.resenhaStatus === 'closed') return 'closed';
      if (context.pollStatus === 'closed' || context.expired) return 'poll_closed';
      const isOrganizer = context.organizerId === actorId;
      if (context.kind === 'split') return 'forbidden';
      if (!isOrganizer && !context.allowSuggestions) return 'forbidden';

      if (context.kind === 'when' && !timeLabelSchema.safeParse(label).success) return 'invalid';
      if (context.kind === 'where') {
        const alcohol = await hasApprovedMinor(db, resenhaId);
        if (
          (await isBlockedText(db, label, { alcohol })) ||
          (await mentionsPerson(db, resenhaId, label))
        ) {
          return 'blocked';
        }
      }

      await db.insert(pollOptions).values({ pollId, label, suggestedBy: actorId });
      await this.broadcast(db, resenhaId);
      return 'ok';
    });
  }

  /** Um voto por pessoa, trocável até fechar (VOT-04). */
  async vote(
    resenhaId: string,
    actorId: string,
    pollId: string,
    optionId: string,
  ): Promise<ActionResult> {
    return this.withDb(async (db) => {
      const context = await this.pollContext(db, resenhaId, pollId, actorId);
      if (!context || context.access !== 'approved') return 'not_found';
      if (context.resenhaStatus === 'closed') return 'closed';
      if (context.expired && context.pollStatus === 'open') {
        await this.closeAndDecide(db, resenhaId, pollId, null);
        await this.broadcast(db, resenhaId);
      }
      if (context.pollStatus === 'closed' || context.expired) return 'poll_closed';

      const [option] = await db
        .select({ id: pollOptions.id })
        .from(pollOptions)
        .where(and(eq(pollOptions.id, optionId), eq(pollOptions.pollId, pollId)));
      if (!option) return 'not_found';

      await db
        .insert(votes)
        .values({ pollId, userId: actorId, optionId })
        .onConflictDoUpdate({
          target: [votes.pollId, votes.userId],
          set: { optionId, updatedAt: sql`now()` },
        });
      await this.broadcast(db, resenhaId);
      return 'ok';
    });
  }

  /**
   * Fecha a votação e aplica a vencedora. Em empate, só fecha e devolve
   * 'tie': o organizador escolhe depois (VOT-05).
   */
  private async closeAndDecide(
    db: Database,
    resenhaId: string,
    pollId: string,
    chosenOptionId: string | null,
  ): Promise<'ok' | 'tie' | 'invalid'> {
    await db
      .update(polls)
      .set({ status: 'closed', closedAt: sql`now()` })
      .where(and(eq(polls.id, pollId), eq(polls.status, 'open')));

    const poll = (await loadPolls(db, resenhaId)).find((item) => item.id === pollId);
    if (!poll || poll.winningOptionId) return 'ok';
    if (poll.options.length === 0) {
      await markDecidedIfDone(db, resenhaId);
      return 'ok';
    }
    const top = leaders(poll);
    const winner = top.length === 1 ? top[0] : chosenOptionId;
    if (!winner) return 'tie';
    if (!top.includes(winner)) return 'invalid';
    await applyWinner(db, resenhaId, pollId, winner);
    return 'ok';
  }

  /** O organizador fecha a votação ou desempata uma já fechada (VOT-05). */
  async closePoll(
    resenhaId: string,
    actorId: string,
    pollId: string,
    chosenOptionId: string | null,
  ): Promise<ActionResult> {
    return this.withDb(async (db) => {
      const context = await this.pollContext(db, resenhaId, pollId, actorId);
      if (!context || context.organizerId !== actorId) return 'not_found';
      if (context.resenhaStatus === 'closed') return 'closed';
      const result = await this.closeAndDecide(db, resenhaId, pollId, chosenOptionId);
      await this.broadcast(db, resenhaId);
      return result;
    });
  }

  /** Prazo opcional (VOT-05): o alarme do objeto fecha a votação na hora. */
  async setDeadline(
    resenhaId: string,
    actorId: string,
    pollId: string,
    closesAt: string | null,
  ): Promise<ActionResult> {
    return this.withDb(async (db) => {
      const context = await this.pollContext(db, resenhaId, pollId, actorId);
      if (!context || context.organizerId !== actorId) return 'not_found';
      if (context.resenhaStatus === 'closed') return 'closed';
      if (context.pollStatus === 'closed') return 'poll_closed';
      if (closesAt && new Date(closesAt).getTime() <= Date.now()) return 'invalid';

      await db
        .update(polls)
        .set({ closesAt: closesAt ? new Date(closesAt) : null })
        .where(eq(polls.id, pollId));
      await this.ctx.storage.put('resenhaId', resenhaId);
      await this.scheduleNextDeadline(db, resenhaId);
      await this.broadcast(db, resenhaId);
      return 'ok';
    });
  }

  private async scheduleNextDeadline(db: Database, resenhaId: string) {
    const [next] = await db
      .select({ closesAt: polls.closesAt })
      .from(polls)
      .where(
        and(eq(polls.resenhaId, resenhaId), eq(polls.status, 'open'), isNotNull(polls.closesAt)),
      )
      .orderBy(asc(polls.closesAt))
      .limit(1);
    if (next?.closesAt) await this.ctx.storage.setAlarm(next.closesAt);
    else await this.ctx.storage.deleteAlarm();
  }

  /** Fecha as votações cujo prazo venceu. */
  override async alarm() {
    const resenhaId = await this.ctx.storage.get<string>('resenhaId');
    if (!resenhaId) return;
    await this.withDb(async (db) => {
      const due = await db
        .select({ id: polls.id })
        .from(polls)
        .where(
          and(
            eq(polls.resenhaId, resenhaId),
            eq(polls.status, 'open'),
            sql`${polls.closesAt} <= now()`,
          ),
        );
      for (const poll of due) await this.closeAndDecide(db, resenhaId, poll.id, null);
      await this.scheduleNextDeadline(db, resenhaId);
      if (due.length > 0) await this.broadcast(db, resenhaId);
    });
  }

  /** O organizador libera ou trava as sugestões (VOT-03). */
  async setAllowSuggestions(
    resenhaId: string,
    actorId: string,
    allow: boolean,
  ): Promise<ActionResult> {
    return this.withDb(async (db) => {
      const updated = await db
        .update(resenhas)
        .set({ allowSuggestions: allow, updatedAt: sql`now()` })
        .where(and(eq(resenhas.id, resenhaId), eq(resenhas.organizerId, actorId)))
        .returning({ id: resenhas.id });
      if (updated.length === 0) return 'not_found';
      await this.broadcast(db, resenhaId);
      return 'ok';
    });
  }

  /**
   * "Pode ser lá em casa" (DIV-04): vira opção de onde mostrando só o
   * bairro. Uma oferta por pessoa. Nenhum endereço é guardado aqui.
   */
  async offerHome(resenhaId: string, actorId: string, neighborhood: string): Promise<ActionResult> {
    return this.withDb(async (db) => {
      const [where] = await db
        .select({ id: polls.id, status: polls.status })
        .from(polls)
        .where(and(eq(polls.resenhaId, resenhaId), eq(polls.kind, 'where')));
      if (!where) return 'not_found';
      const context = await this.pollContext(db, resenhaId, where.id, actorId);
      if (!context || context.access !== 'approved') return 'not_found';
      if (context.resenhaStatus === 'closed') return 'closed';
      if (context.pollStatus === 'closed' || context.expired) return 'poll_closed';

      const [already] = await db
        .select({ id: pollOptions.id })
        .from(pollOptions)
        .where(and(eq(pollOptions.pollId, where.id), eq(pollOptions.offeredHomeBy, actorId)));
      if (already) return 'invalid';

      const alcohol = await hasApprovedMinor(db, resenhaId);
      if (
        (await isBlockedText(db, neighborhood, { alcohol })) ||
        (await mentionsPerson(db, resenhaId, neighborhood))
      ) {
        return 'blocked';
      }

      await db.insert(pollOptions).values({
        pollId: where.id,
        label: homeLabel(neighborhood),
        suggestedBy: actorId,
        offeredHomeBy: actorId,
        neighborhood,
      });
      await this.broadcast(db, resenhaId);
      return 'ok';
    });
  }

  /** Endereço exato, informado pelo anfitrião depois que a casa vence (LOC-02). */
  async setAddress(resenhaId: string, actorId: string, address: string): Promise<ActionResult> {
    return this.withDb(async (db) => {
      const [resenha] = await db
        .select({ status: resenhas.status, hostId: resenhas.hostId })
        .from(resenhas)
        .where(eq(resenhas.id, resenhaId));
      if (!resenha || resenha.hostId !== actorId) return 'not_found';
      if (resenha.status === 'closed') return 'closed';
      await db
        .update(resenhas)
        .set({ exactAddress: address, updatedAt: sql`now()` })
        .where(eq(resenhas.id, resenhaId));
      await this.broadcast(db, resenhaId);
      return 'ok';
    });
  }

  /** Valor total do rateio, informado pelo organizador (DIV-02). */
  async setTotalCost(
    resenhaId: string,
    actorId: string,
    totalCostCents: number | null,
  ): Promise<ActionResult> {
    return this.withDb(async (db) => {
      const [resenha] = await db
        .select({
          status: resenhas.status,
          organizerId: resenhas.organizerId,
          splitModel: resenhas.splitModel,
        })
        .from(resenhas)
        .where(eq(resenhas.id, resenhaId));
      if (!resenha || resenha.organizerId !== actorId) return 'not_found';
      if (resenha.status === 'closed') return 'closed';
      if (resenha.splitModel !== 'equal_split') return 'forbidden';
      await db
        .update(resenhas)
        .set({ totalCostCents, updatedAt: sql`now()` })
        .where(eq(resenhas.id, resenhaId));
      await this.broadcast(db, resenhaId);
      return 'ok';
    });
  }

  /** Participante aprovado numa resenha aberta com "cada um leva" (DIV-01). */
  private async itemContext(db: Database, resenhaId: string, actorId: string) {
    const [row] = await db
      .select({
        status: resenhas.status,
        organizerId: resenhas.organizerId,
        splitModel: resenhas.splitModel,
        access: participations.access,
      })
      .from(resenhas)
      .leftJoin(
        participations,
        and(eq(participations.resenhaId, resenhas.id), eq(participations.userId, actorId)),
      )
      .where(eq(resenhas.id, resenhaId));
    if (!row || row.access !== 'approved') return 'not_found' as const;
    if (row.status === 'closed') return 'closed' as const;
    if (row.splitModel !== 'each_brings') return 'forbidden' as const;
    return row;
  }

  async addItem(resenhaId: string, actorId: string, description: string): Promise<ActionResult> {
    return this.withDb(async (db) => {
      const context = await this.itemContext(db, resenhaId, actorId);
      if (typeof context === 'string') return context;
      // Ofensivo sempre; álcool quando há menor aprovado (spec, seção 3)
      const alcohol = await hasApprovedMinor(db, resenhaId);
      if (await isBlockedText(db, description, { alcohol })) return 'blocked';
      await db.insert(items).values({ resenhaId, description, createdBy: actorId });
      await this.broadcast(db, resenhaId);
      return 'ok';
    });
  }

  /** Assumir, largar, marcar como garantido ou apagar um item (DIV-01, DIV-03). */
  async updateItem(
    resenhaId: string,
    actorId: string,
    itemId: string,
    action: 'claim' | 'release' | 'secure' | 'unsecure' | 'delete',
  ): Promise<ActionResult> {
    return this.withDb(async (db) => {
      const context = await this.itemContext(db, resenhaId, actorId);
      if (typeof context === 'string') return context;
      const [item] = await db
        .select({ ownerId: items.ownerId, createdBy: items.createdBy })
        .from(items)
        .where(and(eq(items.id, itemId), eq(items.resenhaId, resenhaId)));
      if (!item) return 'not_found';
      const isOrganizer = context.organizerId === actorId;
      const where = and(eq(items.id, itemId), eq(items.resenhaId, resenhaId));

      if (action === 'claim') {
        // No máximo um responsável: só assume se ninguém assumiu (atômico)
        const claimed = await db
          .update(items)
          .set({ ownerId: actorId, updatedAt: sql`now()` })
          .where(and(where, isNull(items.ownerId)))
          .returning({ id: items.id });
        if (claimed.length === 0) return 'forbidden';
      } else if (action === 'release') {
        if (item.ownerId !== actorId) return 'forbidden';
        await db
          .update(items)
          .set({ ownerId: null, status: 'open', updatedAt: sql`now()` })
          .where(where);
      } else if (action === 'secure' || action === 'unsecure') {
        if (item.ownerId !== actorId && !isOrganizer) return 'forbidden';
        if (action === 'secure' && item.ownerId === null) return 'invalid';
        await db
          .update(items)
          .set({ status: action === 'secure' ? 'secured' : 'open', updatedAt: sql`now()` })
          .where(where);
      } else {
        if (item.createdBy !== actorId && !isOrganizer) return 'forbidden';
        await db.delete(items).where(where);
      }
      await this.broadcast(db, resenhaId);
      return 'ok';
    });
  }
}
