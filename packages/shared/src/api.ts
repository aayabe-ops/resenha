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
  | 'forbidden'
  | 'phone_required'
  | 'group_full'
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

/** Perfil visto por outra pessoa (ACE-05): só apelido, foto e grupos em comum. */
export interface PublicProfile {
  id: string;
  nickname: string;
  photoUrl: string | null;
  commonGroups: { id: string; name: string }[];
}

export type GroupRole = 'admin' | 'member';
export type MembershipStatus = 'pending' | 'approved' | 'removed';

/** Item de "meus grupos": só grupos em que a pessoa é membro aprovada. */
export interface GroupSummary {
  id: string;
  name: string;
  photoUrl: string | null;
  role: GroupRole;
}

export interface GroupMember {
  id: string;
  nickname: string;
  photoUrl: string | null;
  role: GroupRole;
}

export interface GroupDetail extends GroupSummary {
  inviteCode: string;
  members: GroupMember[];
  /** Pedidos pendentes; só o admin recebe a lista (vazia para os demais). */
  pending: { id: string; nickname: string; photoUrl: string | null }[];
}

/** Resenha encerrada no histórico do grupo (GRP-04). */
export interface GroupHistoryItem {
  id: string;
  name: string | null;
  date: string;
  neighborhood: string | null;
}

/** O que quem abre o link de convite vê: só o nome do grupo (GRP-03). */
export interface InviteInfo {
  groupId: string;
  name: string;
  status: MembershipStatus | null;
}
