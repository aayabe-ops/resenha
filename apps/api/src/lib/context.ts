import type { Database } from '@resenha/db/client';

/** Bindings do Worker. TURNSTILE_SECRET_KEY só existe fora do modo dev. */
export type Bindings = Env & { TURNSTILE_SECRET_KEY?: string };

export interface SessionUser {
  id: string;
  sessionId: string;
  nickname: string;
  photoUrl: string | null;
  phoneE164: string | null;
  birthDate: string;
}

export interface AppEnv {
  Bindings: Bindings;
  Variables: {
    /** Conexão aberta sob demanda, uma por requisição (ADR 0007). */
    db: () => Promise<Database>;
    user: SessionUser;
    /** Usuário opcional, nas rotas abertas por link (optionalUser). */
    viewer: SessionUser | null;
  };
}
