import { groupNameSchema, type GroupSummary, type Me } from '@resenha/shared';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api';
import { navigate } from '../router';
import { Form } from './Form';
import { Link } from './Link';
import { Profile } from './Profile';

// Início: meus grupos (só os que a pessoa é membro aprovada), criar grupo
// (GRP-01) e o perfil. TODO(copy): revisar todos os textos desta tela
export function Home({ me, onLoggedOut }: { me: Me; onLoggedOut: () => void }) {
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (me.isGuest) return;
    let active = true;
    api.listGroups().then(
      (list) => active && setGroups(list),
      (failure) => active && setError(errorMessage(failure)),
    );
    return () => {
      active = false;
    };
  }, [me.isGuest]);

  async function createGroup() {
    if (!groupNameSchema.safeParse(name).success) {
      setError('O nome do grupo pode ter até 40 letras.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const group = await api.createGroup(name.trim());
      navigate(`/grupo/${group.id}`);
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <>
      {me.isGuest ? (
        <p>Para criar ou entrar em grupos, entra com seu celular.</p>
      ) : (
        <>
          <section>
            <h2>Meus grupos</h2>
            {groups === null && !error && <p>Carregando…</p>}
            {groups?.length === 0 && <p>Você ainda não está em nenhum grupo.</p>}
            <ul>
              {groups?.map((group) => (
                <li key={group.id}>
                  <Link to={`/grupo/${group.id}`}>{group.name}</Link>
                </li>
              ))}
            </ul>
          </section>
          <Form
            title="Criar grupo"
            submitLabel="Criar"
            busy={busy}
            error={error}
            onSubmit={() => void createGroup()}
          >
            <label>
              Nome do grupo
              <input
                maxLength={40}
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          </Form>
        </>
      )}
      <Profile me={me} onLoggedOut={onLoggedOut} />
    </>
  );
}
