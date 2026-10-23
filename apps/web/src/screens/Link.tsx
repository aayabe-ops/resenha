import type { MouseEvent, ReactNode } from 'react';
import { navigate } from '../router';

export function Link({ to, children }: { to: string; children: ReactNode }) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    navigate(to);
  }
  return (
    <a href={to} onClick={handleClick}>
      {children}
    </a>
  );
}
