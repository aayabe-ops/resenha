// Formatos de resposta da API compartilhados com o front.

export type ApiErrorCode =
  | 'invalid_request'
  | 'under_age'
  | 'turnstile_failed'
  | 'rate_limited'
  | 'code_locked'
  | 'invalid_code'
  | 'invalid_registration'
  | 'unauthorized'
  | 'not_found'
  | 'internal';

export interface ApiError {
  error: ApiErrorCode;
}

export type VerifyCodeResponse =
  { status: 'logged_in' } | { status: 'needs_registration'; registrationToken: string };

/** O próprio usuário. Celular e nascimento não são devolvidos (minimização). */
export interface Me {
  id: string;
  nickname: string;
  photoUrl: string | null;
  isMinor: boolean;
  isGuest: boolean;
}

/** Perfil visto por outra pessoa (ACE-05): só apelido e foto. */
export interface PublicProfile {
  id: string;
  nickname: string;
  photoUrl: string | null;
}
