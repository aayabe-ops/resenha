import type { ResenhaItem, ResenhaView } from '@resenha/shared';
import { useState } from 'react';
import { api } from '../api';
import { formatMoney, parseMoney } from '../format';

// TODO(copy): revisar todos os textos desta tela

/** Apple Maps em aparelhos Apple; Google Maps nos demais (LOC-04). */
function mapUrl(address: string): string {
  const query = encodeURIComponent(address);
  return /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)
    ? `https://maps.apple.com/?q=${query}`
    : `https://www.google.com/maps/search/?api=1&query=${query}`;
}

interface Props {
  resenha: ResenhaView;
  busy: boolean;
  act: (action: () => Promise<unknown>) => void;
}

/** Local (LOC-02, LOC-04): endereço para quem pode, e o anfitrião informa. */
export function Place({ resenha, busy, act }: Props) {
  const [address, setAddress] = useState(resenha.exactAddress ?? '');
  const open = resenha.status !== 'closed';
  if (!resenha.host && !resenha.exactAddress) return null;

  return (
    <section aria-label="Local">
      <h3>Local</h3>
      {resenha.host && <p>Na casa de {resenha.host.nickname}</p>}
      {resenha.exactAddress ? (
        <>
          <p>{resenha.exactAddress}</p>
          <a
            className="button"
            href={mapUrl(resenha.exactAddress)}
            target="_blank"
            rel="noreferrer"
          >
            Abrir no mapa
          </a>
        </>
      ) : resenha.me?.isOrganizer || resenha.me?.isHost ? (
        <p>O endereço ainda não foi informado.</p>
      ) : (
        <p>O endereço aparece aqui quando você confirmar &quot;Vou&quot;.</p>
      )}
      {resenha.me?.isHost && open && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (address.trim()) act(() => api.setAddress(resenha.id, address.trim()));
          }}
        >
          <label>
            Endereço (só quem vai vê; apagado 24 h depois de encerrar)
            <input
              maxLength={200}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          </label>
          <button type="submit" disabled={busy}>
            Salvar endereço
          </button>
        </form>
      )}
    </section>
  );
}

/** Rateio (DIV-02): total informado pelo organizador e valor por quem vai. */
export function Split({ resenha, busy, act }: Props) {
  const [total, setTotal] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (resenha.splitModel !== 'equal_split') return null;
  const isOrganizer = resenha.me?.isOrganizer ?? false;

  return (
    <section aria-label="Rateio">
      <h3>Rateio</h3>
      {resenha.totalCostCents === null ? (
        <p>Quem organiza ainda não colocou o valor total.</p>
      ) : (
        <p>
          Total: {formatMoney(resenha.totalCostCents)}
          {resenha.perPersonCents !== null &&
            ` · ${formatMoney(resenha.perPersonCents)} para cada um dos ${resenha.counts.going} que vão`}
        </p>
      )}
      {isOrganizer && resenha.status !== 'closed' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const cents = parseMoney(total);
            if (cents === null) {
              setError('Coloca um valor como 150 ou 150,50.');
              return;
            }
            setError(null);
            act(() => api.setTotalCost(resenha.id, cents));
          }}
        >
          <label>
            Valor total (R$)
            <input
              inputMode="decimal"
              value={total}
              onChange={(event) => setTotal(event.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy}>
            Salvar total
          </button>
        </form>
      )}
    </section>
  );
}

/** Quem leva o quê (DIV-01, DIV-03): o que falta aparece primeiro, em destaque. */
export function Items({ resenha, busy, act }: Props) {
  const [description, setDescription] = useState('');
  if (resenha.splitModel !== 'each_brings') return null;
  const myId = resenha.me?.id;
  const isOrganizer = resenha.me?.isOrganizer ?? false;
  const open = resenha.status !== 'closed';
  const missing = resenha.items.filter((item) => item.status === 'open');
  const secured = resenha.items.filter((item) => item.status === 'secured');

  const row = (item: ResenhaItem) => (
    <li key={item.id}>
      {item.description}
      {item.owner ? ` · ${item.owner.nickname} leva` : ' · ninguém pegou ainda'}
      {open && !item.owner && (
        <button
          type="button"
          disabled={busy}
          onClick={() => act(() => api.itemAction(resenha.id, item.id, 'claim'))}
        >
          Eu levo
        </button>
      )}
      {open && item.owner?.id === myId && (
        <button
          type="button"
          disabled={busy}
          onClick={() => act(() => api.itemAction(resenha.id, item.id, 'release'))}
        >
          Não vou levar
        </button>
      )}
      {open && item.owner && (item.owner.id === myId || isOrganizer) && (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            act(() =>
              api.itemAction(
                resenha.id,
                item.id,
                item.status === 'secured' ? 'unsecure' : 'secure',
              ),
            )
          }
        >
          {item.status === 'secured' ? 'Ainda não garantido' : 'Garantido'}
        </button>
      )}
      {open && (item.createdBy.id === myId || isOrganizer) && (
        <button
          type="button"
          disabled={busy}
          onClick={() => act(() => api.itemAction(resenha.id, item.id, 'delete'))}
        >
          Apagar
        </button>
      )}
    </li>
  );

  return (
    <section aria-label="Quem leva o quê">
      <h3>Quem leva o quê</h3>
      <div className="missing">
        <h4>O que falta ({missing.length})</h4>
        {missing.length === 0 ? <p>Nada faltando!</p> : <ul>{missing.map(row)}</ul>}
      </div>
      {secured.length > 0 && (
        <>
          <h4>Garantido</h4>
          <ul>{secured.map(row)}</ul>
        </>
      )}
      {open && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!description.trim()) return;
            act(async () => {
              await api.addItem(resenha.id, description.trim());
              setDescription('');
            });
          }}
        >
          <label>
            Novo item
            <input
              maxLength={60}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <button type="submit" disabled={busy}>
            Adicionar
          </button>
        </form>
      )}
    </section>
  );
}
