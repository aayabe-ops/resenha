import { resenhaNameSchema, todayIso, type PollKind, type ResenhaSummary } from '@resenha/shared';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api';
import { formatLongDate } from '../format';
import { navigate } from '../router';
import { Form } from './Form';
import { Link } from './Link';

const POLL_LABELS: Record<PollKind, string> = {
  where: 'Onde',
  when: 'Que horas',
  split: 'Como divide',
}; // TODO(copy): revisar

function tomorrow(): string {
  const date = new Date(`${todayIso()}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

// Resenhas ativas do grupo e criar resenha em até 3 toques (RES-01): abrir,
// escolher o dia, criar. Nome opcional; as três votações vêm marcadas.
// TODO(copy): revisar todos os textos desta tela
export function GroupResenhas({ groupId }: { groupId: string }) {
  const [resenhas, setResenhas] = useState<ResenhaSummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [date, setDate] = useState(tomorrow);
  const [polls, setPolls] = useState<PollKind[]>(['where', 'when', 'split']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.listResenhas(groupId).then(
      (list) => active && setResenhas(list),
      (failure) => active && setError(errorMessage(failure)),
    );
    return () => {
      active = false;
    };
  }, [groupId]);

  async function create() {
    const trimmed = name.trim();
    if (trimmed && !resenhaNameSchema.safeParse(trimmed).success) {
      setError('O nome pode ter até 60 letras.');
      return;
    }
    if (date < todayIso()) {
      setError('Escolhe hoje ou um dia que ainda vai chegar.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await api.createResenha(groupId, { name: trimmed || null, date, polls });
      navigate(`/r/${created.inviteCode}`);
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  function togglePoll(kind: PollKind) {
    setPolls((current) =>
      current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind],
    );
  }

  return (
    <>
      <h3>Resenhas</h3>
      {resenhas.length === 0 ? (
        <p>Nenhuma resenha marcada.</p>
      ) : (
        <ul>
          {resenhas.map((resenha) => (
            <li key={resenha.id}>
              <Link to={`/r/${resenha.inviteCode}`}>
                {resenha.name ?? 'Resenha'} · {formatLongDate(resenha.date)}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <Form
          title="Nova resenha"
          submitLabel="Criar resenha"
          busy={busy}
          error={error}
          onSubmit={() => void create()}
        >
          <label>
            Dia
            <input
              type="date"
              required
              min={todayIso()}
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <label>
            Nome (opcional)
            <input maxLength={60} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <fieldset>
            <legend>Votações</legend>
            {(Object.keys(POLL_LABELS) as PollKind[]).map((kind) => (
              <label key={kind} className="inline">
                <input
                  type="checkbox"
                  checked={polls.includes(kind)}
                  onChange={() => togglePoll(kind)}
                />
                {POLL_LABELS[kind]}
              </label>
            ))}
          </fieldset>
        </Form>
      ) : (
        <button type="button" onClick={() => setCreating(true)}>
          Bora fazer uma resenha?
        </button>
      )}
    </>
  );
}
