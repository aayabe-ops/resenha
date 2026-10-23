import type { GroupDetail, GroupHistoryItem } from '@resenha/shared';
import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../api';
import { formatDate } from '../format';
import { GroupResenhas } from './GroupResenhas';
import { Link } from './Link';

// Página do grupo: link de convite, membros, pedidos (admin) e histórico
// (GRP-03, GRP-04). TODO(copy): revisar todos os textos desta tela
export function GroupPage({ id }: { id: string }) {
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [history, setHistory] = useState<GroupHistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all([api.getGroup(id), api.groupHistory(id)]).then(
      ([detail, past]) => {
        if (!active) return;
        setGroup(detail);
        setHistory(past);
      },
      (failure) => active && setError(errorMessage(failure)),
    );
    return () => {
      active = false;
    };
  }, [id, version]);

  const act = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setVersion((value) => value + 1);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }, []);

  if (!group) {
    return (
      <section>
        <p role={error ? 'alert' : undefined}>{error ?? 'Carregando…'}</p>
        <Link to="/">Voltar</Link>
      </section>
    );
  }

  const inviteLink = `${window.location.origin}/g/${group.inviteCode}`;
  const isAdmin = group.role === 'admin';

  return (
    <section>
      <Link to="/">Voltar</Link>
      <h2>{group.name}</h2>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      <GroupResenhas groupId={group.id} />

      <h3>Link de convite</h3>
      <p>Quem entrar pelo link fica esperando um admin aprovar.</p>
      <input readOnly value={inviteLink} aria-label="Link de convite" />
      <button
        type="button"
        onClick={() => void navigator.clipboard.writeText(inviteLink).then(() => setCopied(true))}
      >
        {copied ? 'Link copiado' : 'Copiar link'}
      </button>

      {isAdmin && group.pending.length > 0 && (
        <>
          <h3>Pedidos para entrar</h3>
          <ul>
            {group.pending.map((person) => (
              <li key={person.id}>
                {person.nickname}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act(() => api.approveMember(group.id, person.id))}
                >
                  Aprovar
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act(() => api.removeMember(group.id, person.id))}
                >
                  Recusar
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>Membros ({group.members.length})</h3>
      <ul>
        {group.members.map((member) => (
          <li key={member.id}>
            {member.nickname}
            {member.role === 'admin' && ' (admin)'}
            {isAdmin && member.role !== 'admin' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void act(() => api.removeMember(group.id, member.id))}
              >
                Remover
              </button>
            )}
          </li>
        ))}
      </ul>

      <h3>Resenhas passadas</h3>
      {history.length === 0 ? (
        <p>Nenhuma resenha encerrada ainda.</p>
      ) : (
        <ul>
          {history.map((item) => (
            <li key={item.id}>
              {item.name ?? 'Resenha'} · {formatDate(item.date)}
              {item.neighborhood && ` · ${item.neighborhood}`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
