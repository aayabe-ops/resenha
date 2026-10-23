import type { InviteInfo } from '@resenha/shared';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api';
import { Link } from './Link';

// Quem abre o link de convite vê só o nome do grupo e pede para entrar
// (GRP-02, GRP-03). TODO(copy): revisar todos os textos desta tela
export function InvitePage({ code }: { code: string }) {
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api.getInvite(code).then(
      (info) => active && setInvite(info),
      (failure) => active && setError(errorMessage(failure)),
    );
    return () => {
      active = false;
    };
  }, [code]);

  async function requestToJoin() {
    if (!invite) return;
    setBusy(true);
    setError(null);
    try {
      const { status } = await api.joinInvite(code);
      setInvite({ ...invite, status });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  if (!invite) {
    return (
      <section>
        <p role={error ? 'alert' : undefined}>
          {error ? 'Esse link de convite não vale.' : 'Carregando…'}
        </p>
        <Link to="/">Ir para o início</Link>
      </section>
    );
  }

  return (
    <section>
      <h2>{invite.name}</h2>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {invite.status === null && (
        <button type="button" disabled={busy} onClick={() => void requestToJoin()}>
          Pedir para entrar
        </button>
      )}
      {invite.status === 'pending' && <p>Pedido enviado. Agora é esperar um admin aprovar.</p>}
      {invite.status === 'approved' && (
        <Link to={`/grupo/${invite.groupId}`}>Você já está no grupo. Abrir</Link>
      )}
      {invite.status === 'removed' && <p>Não dá para entrar neste grupo por este link.</p>}
      <p>
        <Link to="/">Ir para o início</Link>
      </p>
    </section>
  );
}
