import { useSyncExternalStore } from 'react';

// Navegação por endereço com código próprio (sem biblioteca de rotas, que
// exigiria ADR): history.pushState + evento para avisar os componentes.
const NAVIGATE_EVENT = 'resenha:navigate';

function subscribe(onChange: () => void) {
  window.addEventListener('popstate', onChange);
  window.addEventListener(NAVIGATE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(NAVIGATE_EVENT, onChange);
  };
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

export function navigate(path: string) {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

export type Route =
  | { name: 'home' }
  | { name: 'group'; id: string }
  | { name: 'invite'; code: string }
  | { name: 'resenha'; code: string }
  | { name: 'notFound' };

export function matchRoute(path: string): Route {
  if (path === '/') return { name: 'home' };
  const group = path.match(/^\/grupo\/([^/]+)$/);
  if (group?.[1]) return { name: 'group', id: decodeURIComponent(group[1]) };
  const invite = path.match(/^\/g\/([^/]+)$/);
  if (invite?.[1]) return { name: 'invite', code: decodeURIComponent(invite[1]) };
  const resenha = path.match(/^\/r\/([^/]+)$/);
  if (resenha?.[1]) return { name: 'resenha', code: decodeURIComponent(resenha[1]) };
  return { name: 'notFound' };
}
