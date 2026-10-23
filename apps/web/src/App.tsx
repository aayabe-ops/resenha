import { APP_NAME, type Me } from '@resenha/shared';
import { useEffect, useState } from 'react';
import { api } from './api';
import { matchRoute, navigate, usePath } from './router';
import { GroupPage } from './screens/GroupPage';
import { Home } from './screens/Home';
import { InvitePage } from './screens/InvitePage';
import { Link } from './screens/Link';
import { Login } from './screens/Login';
import { ResenhaPage } from './screens/ResenhaPage';

type State = { name: 'loading' } | { name: 'loggedOut' } | { name: 'loggedIn'; me: Me };

export function App() {
  const [state, setState] = useState<State>({ name: 'loading' });
  // Muda a cada login para buscar /api/me de novo
  const [sessionVersion, setSessionVersion] = useState(0);
  const route = matchRoute(usePath());

  useEffect(() => {
    let active = true;
    api.me().then(
      (me) => active && setState({ name: 'loggedIn', me }),
      () => active && setState({ name: 'loggedOut' }),
    );
    return () => {
      active = false;
    };
  }, [sessionVersion]);

  const onSessionChange = () => setSessionVersion((version) => version + 1);

  function renderRoute(me: Me) {
    // Grupos exigem login com celular (spec, seção 3). TODO(copy): revisar
    if (route.name !== 'home' && route.name !== 'resenha' && me.isGuest) {
      return <p>Para entrar em grupos, entra com seu celular.</p>;
    }
    switch (route.name) {
      case 'home':
        return (
          <Home
            me={me}
            onLoggedOut={() => {
              setState({ name: 'loggedOut' });
              navigate('/');
            }}
          />
        );
      case 'group':
        return <GroupPage id={route.id} />;
      case 'invite':
        return <InvitePage code={route.code} />;
      case 'resenha':
        return <ResenhaPage code={route.code} me={me} onSessionChange={onSessionChange} />;
      case 'notFound':
        // TODO(copy): revisar
        return (
          <p>
            Página não encontrada. <Link to="/">Ir para o início</Link>
          </p>
        );
    }
  }

  return (
    <main>
      <h1>{APP_NAME}</h1>
      {/* Quem abre um convite sem sessão faz login e continua no mesmo endereço */}
      {/* A página da resenha abre sem sessão e oferece celular ou convidado (ACE-01) */}
      {state.name === 'loggedOut' &&
        (route.name === 'resenha' ? (
          <ResenhaPage code={route.code} me={null} onSessionChange={onSessionChange} />
        ) : (
          <Login onLoggedIn={onSessionChange} />
        ))}
      {state.name === 'loggedIn' && renderRoute(state.me)}
    </main>
  );
}
