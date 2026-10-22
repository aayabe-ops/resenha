import type { Me } from '@resenha/shared';
import { useState } from 'react';
import { api, errorMessage } from '../api';

// Perfil mínimo do próprio usuário (ACE-05), sair e excluir conta (ACE-06).
export function Profile({ me, onLoggedOut }: { me: Me; onLoggedOut: () => void }) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onLoggedOut();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  // TODO(copy): revisar todos os textos desta tela
  return (
    <section>
      <h2>{me.nickname}</h2>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button type="button" disabled={busy} onClick={() => run(api.logout)}>
        Sair
      </button>

      {confirmingDelete ? (
        <div className="danger">
          <p>
            Isso apaga seus dados pessoais (apelido, foto, celular e nascimento). Seus votos e itens
            ficam como &quot;ex-participante&quot;. Não dá para desfazer.
          </p>
          <button type="button" disabled={busy} onClick={() => run(api.deleteAccount)}>
            Excluir minha conta
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirmingDelete(false)}>
            Cancelar
          </button>
        </div>
      ) : (
        <button type="button" disabled={busy} onClick={() => setConfirmingDelete(true)}>
          Excluir conta
        </button>
      )}
    </section>
  );
}
