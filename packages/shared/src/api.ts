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
  | 'resenha_closed'
  | 'poll_closed'
  | 'blocked_text'
  | 'tie'
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

export type Rsvp = 'going' | 'maybe' | 'not_going';
export type AccessStatus = 'pending' | 'approved' | 'rejected' | 'removed';
export type PollKind = 'where' | 'when' | 'split';
export type ResenhaStatus = 'open' | 'decided' | 'closed';
export type SplitModel = 'equal_split' | 'each_brings' | 'own_drinks' | 'each_their_own';

/** Opção com placar e quem votou nela (VOT-04). */
export interface PollOption {
  id: string;
  label: string;
  splitModel: SplitModel | null;
  suggestedBy: { id: string; nickname: string } | null;
  voters: { id: string; nickname: string }[];
}

export interface Poll {
  id: string;
  kind: PollKind;
  status: 'open' | 'closed';
  closesAt: string | null;
  winningOptionId: string | null;
  /** Fechada sem vencedora e com empate: o organizador escolhe entre estas (VOT-05). */
  tiedOptionIds: string[];
  options: PollOption[];
}

/** Resenha ativa na página do grupo. */
export interface ResenhaSummary {
  id: string;
  name: string | null;
  date: string;
  status: ResenhaStatus;
  inviteCode: string;
}

export interface ResenhaCounts {
  going: number;
  maybe: number;
  notGoing: number;
}

/** Participante aprovado (RES-04); só quem é aprovado recebe a lista. */
export interface ResenhaParticipant {
  id: string;
  nickname: string;
  photoUrl: string | null;
  rsvp: Rsvp | null;
  isOrganizer: boolean;
}

/** Pedido de entrada visto pelo organizador (RES-05). */
export interface ResenhaRequest {
  id: string;
  nickname: string;
  photoUrl: string | null;
  inviteSource: 'group_link' | 'resenha_link';
  invitedBy: { id: string; nickname: string } | null;
  commonFriends: { id: string; nickname: string }[];
}

/** Estado ao vivo que o Durable Object envia pelo WebSocket. */
export interface ResenhaLive {
  status: ResenhaStatus;
  counts: ResenhaCounts;
  participants: ResenhaParticipant[];
  /** Só o organizador recebe; para os demais, vazio. */
  requests: ResenhaRequest[];
  /** Votações com opções e placar; só para participantes aprovados. */
  polls: Poll[];
  allowSuggestions: boolean;
  /** Regras definidas pelas votações vencedoras (VOT-06). */
  neighborhood: string | null;
  startsAt: string | null;
  splitModel: SplitModel | null;
}

/** Página da resenha. Sem acesso aprovado, só nome, dia, bairro e contagem (LOC-01). */
export interface ResenhaView extends ResenhaLive {
  id: string;
  groupId: string;
  name: string | null;
  date: string;
  organizer: { id: string; nickname: string };
  /** null quando quem abre o link ainda não tem sessão. */
  me: {
    id: string;
    access: AccessStatus | null;
    rsvp: Rsvp | null;
    isOrganizer: boolean;
    isGroupMember: boolean;
  } | null;
}
