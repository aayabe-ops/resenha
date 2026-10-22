import { APP_NAME, type Me } from '@resenha/shared';
import { useEffect, useState } from 'react';
import { api } from './api';
import { Login } from './screens/Login';
import { Profile } from './screens/Profile';

type State = { name: 'loading' } | { name: 'loggedOut' } | { name: 'loggedIn'; me: Me };

export function App() {
  const [state, setState] = useState<State>({ name: 'loading' });
  // Muda a cada login para buscar /api/me de novo
  const [sessionVersion, setSessionVersion] = useState(0);

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

  return (
    <main>
      <h1>{APP_NAME}</h1>
      {state.name === 'loggedOut' && (
        <Login onLoggedIn={() => setSessionVersion((version) => version + 1)} />
      )}
      {state.name === 'loggedIn' && (
        <Profile me={state.me} onLoggedOut={() => setState({ name: 'loggedOut' })} />
      )}
    </main>
  );
}
