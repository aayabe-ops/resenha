import type { Me, ResenhaLive, ResenhaRequest, ResenhaView, Rsvp } from '@resenha/shared';
import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../api';
import { formatLongDate, formatTime } from '../format';
import { Polls } from './Polls';
import { GuestEntry } from './GuestEntry';
import { Link } from './Link';
import { Login } from './Login';

// TODO(copy): revisar todos os textos desta tela
const RSVP_LABELS: Record<Rsvp, string> = { going: 'Vou', maybe: 'Talvez', not_going: 'Não vou' };
const SPLIT_LABELS = {
  equal_split: 'Rateio igual',
  each_brings: 'Cada um leva uma coisa',
  own_drinks: 'Só bebida',
  each_their_own: 'Cada um com o seu',
} as const;

// Código com que o servidor fecha a conexão de quem foi removido (RES-06)
const REMOVED_CLOSE_CODE = 4403;

/** Quem compartilhou o link (RES-05), lido de ?de= no endereço. */
function sharedBy(): string | null {
  return new URLSearchParams(window.location.search).get('de');
}

function requestSource(request: ResenhaRequest): string {
  if (request.invitedBy) return `pelo link de ${request.invitedBy.nickname}`;
  return request.inviteSource === 'group_link' ? 'pelo grupo' : 'pelo link da resenha';
}

/** Conexão ao vivo (RES-03, RES-04): recebe o estado novo a cada mudança. */
function useLive(
  resenhaId: string | null,
  onLive: (live: ResenhaLive) => void,
  onRemoved: () => void,
) {
  useEffect(() => {
    if (!resenhaId) return;
    let stopped = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const open = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(
        `${protocol}://${window.location.host}/api/resenhas/${resenhaId}/live`,
      );
      socket.addEventListener('message', (event) => {
        onLive(JSON.parse(String(event.data)) as ResenhaLive);
      });
      socket.addEventListener('close', (event) => {
        if (stopped) return;
        if (event.code === REMOVED_CLOSE_CODE) onRemoved();
        else retry = setTimeout(open, 2000);
      });
    };
    open();
    return () => {
      stopped = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, [resenhaId, onLive, onRemoved]);
}

export function ResenhaPage({
  code,
  me,
  onSessionChange,
}: {
  code: string;
  me: Me | null;
  onSessionChange: () => void;
}) {
  const [resenha, setResenha] = useState<ResenhaView | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [entry, setEntry] = useState<'choose' | 'phone' | 'guest'>('choose');
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    api.getResenha(code).then(
      async (view) => {
        // Quem é do grupo entra direto ao abrir o link (RES-05)
        if (
          view.me &&
          view.me.access === null &&
          view.me.isGroupMember &&
          view.status !== 'closed'
        ) {
          await api.joinResenha(code, sharedBy()).catch(() => undefined);
          view = await api.getResenha(code);
        }
        if (active) setResenha(view);
      },
      () => active && setNotFound(true),
    );
    return () => {
      active = false;
    };
  }, [code, version, me?.id]);

  const onLive = useCallback((live: ResenhaLive) => {
    setResenha((current) => (current ? { ...current, ...live } : current));
  }, []);
  const approved = resenha?.me?.access === 'approved';
  useLive(approved && resenha?.status !== 'closed' ? resenha.id : null, onLive, reload);

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
      reload();
    }
  }

  if (notFound) {
    return (
      <p>
        Esse link de resenha não vale. <Link to="/">Ir para o início</Link>
      </p>
    );
  }
  if (!resenha) return <p>Carregando…</p>;

  const title = resenha.name ?? 'Resenha';
  const header = (
    <>
      <h2>{title}</h2>
      <p>
        {formatLongDate(resenha.date)}
        {resenha.startsAt && ` · ${formatTime(resenha.startsAt)}`}
        {resenha.neighborhood && ` · ${resenha.neighborhood}`}
      </p>
      {resenha.splitModel && <p>Divisão: {SPLIT_LABELS[resenha.splitModel]}</p>}
      {resenha.status === 'decided' && <p>Tudo decidido!</p>}
      <p>
        {resenha.counts.going} vão · {resenha.counts.maybe} talvez
      </p>
      {resenha.status === 'closed' && <p>Essa resenha já foi encerrada.</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </>
  );

  // Sem sessão: entrar com celular ou como convidado (ACE-01)
  if (!me || !resenha.me) {
    return (
      <section>
        {header}
        {entry === 'choose' && (
          <>
            <button type="button" onClick={() => setEntry('phone')}>
              Entrar com meu celular
            </button>
            <button type="button" onClick={() => setEntry('guest')}>
              Entrar sem conta
            </button>
          </>
        )}
        {entry === 'phone' && <Login onLoggedIn={onSessionChange} />}
        {entry === 'guest' && <GuestEntry onEntered={onSessionChange} />}
      </section>
    );
  }

  const myAccess = resenha.me.access;
  if (myAccess === 'rejected' || myAccess === 'removed') {
    return (
      <section>
        <h2>{title}</h2>
        <p>Você não tem acesso a esta resenha.</p>
        <Link to="/">Ir para o início</Link>
      </section>
    );
  }

  if (myAccess === null) {
    return (
      <section>
        {header}
        {resenha.status !== 'closed' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(() => api.joinResenha(code, sharedBy()))}
          >
            Pedir para entrar
          </button>
        )}
      </section>
    );
  }

  if (myAccess === 'pending') {
    return (
      <section>
        {header}
        <p>Pedido enviado. Agora é esperar quem organizou aprovar.</p>
      </section>
    );
  }

  const open = resenha.status !== 'closed';
  const isOrganizer = resenha.me.isOrganizer;
  const shareUrl = `${window.location.origin}/r/${code}?de=${encodeURIComponent(resenha.me.id)}`;
  const shareText = `${title} · ${formatLongDate(resenha.date)}\n${shareUrl}`;

  return (
    <section>
      {header}

      {open && (
        <>
          <div role="group" aria-label="Você vai?">
            {(Object.keys(RSVP_LABELS) as Rsvp[]).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={resenha.me?.rsvp === value}
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await api.rsvp(resenha.id, value);
                    setResenha((current) =>
                      current?.me ? { ...current, me: { ...current.me, rsvp: value } } : current,
                    );
                  })
                }
              >
                {RSVP_LABELS[value]}
              </button>
            ))}
          </div>
          <a
            className="button"
            href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
            target="_blank"
            rel="noreferrer"
          >
            Mandar no WhatsApp
          </a>
        </>
      )}

      <Polls
        resenha={resenha}
        myId={resenha.me.id}
        busy={busy}
        act={(action) => void act(action)}
      />

      <h3>Quem tá na resenha</h3>
      <ul>
        {resenha.participants.map((person) => (
          <li key={person.id}>
            {person.nickname}
            {person.isOrganizer && ' (organiza)'}
            {person.rsvp && ` · ${RSVP_LABELS[person.rsvp]}`}
            {isOrganizer && open && !person.isOrganizer && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void act(() => api.decide(resenha.id, person.id, 'remove'))}
              >
                Remover
              </button>
            )}
          </li>
        ))}
      </ul>

      {isOrganizer && resenha.requests.length > 0 && (
        <>
          <h3>Pedidos para entrar</h3>
          <ul>
            {resenha.requests.map((request) => (
              <li key={request.id}>
                {request.nickname} · {requestSource(request)}
                {request.commonFriends.length > 0 &&
                  ` · amigos em comum: ${request.commonFriends.map((friend) => friend.nickname).join(', ')}`}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act(() => api.decide(resenha.id, request.id, 'approve'))}
                >
                  Aprovar
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act(() => api.decide(resenha.id, request.id, 'reject'))}
                >
                  Recusar
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {isOrganizer &&
        open &&
        (confirmingClose ? (
          <div className="danger">
            <p>Encerrar tira a resenha das ativas e manda para o histórico do grupo.</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(() => api.closeResenha(resenha.id))}
            >
              Encerrar resenha
            </button>
            <button type="button" onClick={() => setConfirmingClose(false)}>
              Cancelar
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmingClose(true)}>
            Encerrar resenha
          </button>
        ))}

      <p>
        <Link to={`/grupo/${resenha.groupId}`}>Ver o grupo</Link>
      </p>
    </section>
  );
}
