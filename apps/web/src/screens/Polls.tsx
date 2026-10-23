import type { Poll, PollKind, ResenhaView } from '@resenha/shared';
import { useState } from 'react';
import { api } from '../api';
import { formatDateTime } from '../format';

// TODO(copy): revisar todos os textos desta tela
const TITLES: Record<PollKind, string> = {
  where: 'Onde?',
  when: 'Que horas?',
  split: 'Como divide?',
};

interface PollsProps {
  resenha: ResenhaView;
  myId: string;
  busy: boolean;
  act: (action: () => Promise<unknown>) => void;
}

// Votações ao vivo (VOT-03 a VOT-06): placar com barras e quem votou em quê,
// sugestão de opção, e para o organizador fechar, definir prazo e desempatar.
export function Polls({ resenha, myId, busy, act }: PollsProps) {
  const isOrganizer = resenha.me?.isOrganizer ?? false;
  const open = resenha.status !== 'closed';
  if (resenha.polls.length === 0) return null;

  return (
    <section aria-label="Votações">
      <h3>Votações</h3>
      {isOrganizer && open && (
        <label className="inline">
          <input
            type="checkbox"
            checked={resenha.allowSuggestions}
            disabled={busy}
            onChange={(event) => act(() => api.setSuggestions(resenha.id, event.target.checked))}
          />
          Galera pode sugerir opções
        </label>
      )}
      {resenha.polls.map((poll) => (
        <PollCard
          key={poll.id}
          poll={poll}
          resenha={resenha}
          myId={myId}
          isOrganizer={isOrganizer}
          canSuggest={open && (isOrganizer || resenha.allowSuggestions)}
          busy={busy}
          act={act}
        />
      ))}
    </section>
  );
}

function PollCard({
  poll,
  resenha,
  myId,
  isOrganizer,
  canSuggest,
  busy,
  act,
}: {
  poll: Poll;
  resenha: ResenhaView;
  myId: string;
  isOrganizer: boolean;
  canSuggest: boolean;
  busy: boolean;
  act: (action: () => Promise<unknown>) => void;
}) {
  const [label, setLabel] = useState('');
  const [deadline, setDeadline] = useState('');
  const pollOpen = poll.status === 'open' && resenha.status !== 'closed';
  const totalVotes = poll.options.reduce((sum, option) => sum + option.voters.length, 0);
  const winner = poll.options.find((option) => option.id === poll.winningOptionId);
  const awaitingTieBreak = poll.status === 'closed' && poll.tiedOptionIds.length > 0;

  return (
    <article className="poll">
      <h4>{TITLES[poll.kind]}</h4>
      {winner && <p>Venceu: {winner.label}</p>}
      {poll.status === 'closed' && !winner && !awaitingTieBreak && <p>Fechou sem opções.</p>}
      {awaitingTieBreak && (
        <p>Deu empate. {isOrganizer ? 'Escolhe a vencedora:' : 'Quem organiza escolhe.'}</p>
      )}
      {pollOpen && poll.closesAt && <p>Fecha em {formatDateTime(poll.closesAt)}</p>}

      {poll.options.length === 0 && <p>Nenhuma opção ainda.</p>}
      <ul className="options">
        {poll.options.map((option) => {
          const mine = option.voters.some((voter) => voter.id === myId);
          const share =
            totalVotes === 0 ? 0 : Math.round((option.voters.length / totalVotes) * 100);
          return (
            <li key={option.id}>
              <button
                type="button"
                aria-pressed={mine}
                disabled={busy || !pollOpen}
                onClick={() => act(() => api.vote(resenha.id, poll.id, option.id))}
              >
                {option.label} · {option.voters.length}
              </button>
              <div className="bar" aria-hidden="true">
                <div style={{ width: `${share}%` }} />
              </div>
              {option.voters.length > 0 && (
                <small>{option.voters.map((voter) => voter.nickname).join(', ')}</small>
              )}
              {isOrganizer && awaitingTieBreak && poll.tiedOptionIds.includes(option.id) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => act(() => api.closePoll(resenha.id, poll.id, option.id))}
                >
                  Escolher {option.label}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {pollOpen && canSuggest && poll.kind !== 'split' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!label.trim()) return;
            act(async () => {
              await api.suggestOption(resenha.id, poll.id, label.trim());
              setLabel('');
            });
          }}
        >
          <label>
            {poll.kind === 'when' ? 'Sugerir horário' : 'Sugerir lugar (bairro ou lugar público)'}
            <input
              type={poll.kind === 'when' ? 'time' : 'text'}
              maxLength={60}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <button type="submit" disabled={busy}>
            Sugerir
          </button>
        </form>
      )}

      {isOrganizer && pollOpen && (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              act(() =>
                api.setDeadline(
                  resenha.id,
                  poll.id,
                  deadline ? new Date(deadline).toISOString() : null,
                ),
              );
            }}
          >
            <label>
              Prazo para fechar (opcional)
              <input
                type="datetime-local"
                value={deadline}
                onChange={(event) => setDeadline(event.target.value)}
              />
            </label>
            <button type="submit" disabled={busy}>
              {deadline ? 'Definir prazo' : 'Tirar prazo'}
            </button>
          </form>
          <button
            type="button"
            disabled={busy}
            onClick={() => act(() => api.closePoll(resenha.id, poll.id))}
          >
            Fechar votação
          </button>
        </>
      )}
    </article>
  );
}
