-- Resenha — schema de referência do MVP (Postgres 15+)
--
-- Fonte da verdade do modelo de dados. A primeira migração do Drizzle
-- (entrega 1) deve reproduzir este arquivo. Toda mudança posterior é feita
-- por migração e refletida aqui no mesmo PR.
--
-- Convenções:
--   - nomes em inglês, snake_case; tradução no glossário de modelo-de-dados.md
--   - chaves primárias uuid (gen_random_uuid, nativo no Postgres 13+)
--   - datas e horas em timestamptz (UTC); valores em centavos (integer)
--   - colunas com dado pessoal marcadas com "-- PII"
--   - nada de exclusão em cascata a partir de users: a exclusão de conta
--     anonimiza (ver modelo-de-dados.md, "Exclusão de conta")

-- ---------------------------------------------------------------------------
-- Tipos enumerados
-- ---------------------------------------------------------------------------

CREATE TYPE consent_status AS ENUM ('not_required', 'pending', 'granted', 'denied', 'revoked');
CREATE TYPE group_role AS ENUM ('admin', 'member');
CREATE TYPE membership_status AS ENUM ('pending', 'approved', 'removed');
CREATE TYPE resenha_status AS ENUM ('open', 'decided', 'closed');
CREATE TYPE access_status AS ENUM ('pending', 'approved', 'rejected', 'removed');
CREATE TYPE rsvp AS ENUM ('going', 'maybe', 'not_going');
CREATE TYPE poll_kind AS ENUM ('where', 'when', 'split');
CREATE TYPE poll_status AS ENUM ('open', 'closed');
CREATE TYPE split_model AS ENUM ('equal_split', 'each_brings', 'own_drinks', 'each_their_own');
CREATE TYPE item_status AS ENUM ('open', 'secured');
CREATE TYPE report_target AS ENUM ('user', 'content', 'resenha');
CREATE TYPE report_status AS ENUM ('open', 'in_review', 'resolved', 'dismissed');
CREATE TYPE blocked_term_category AS ENUM ('alcohol', 'offensive');

-- ---------------------------------------------------------------------------
-- Pessoas, acesso e consentimento
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname            text NOT NULL CHECK (char_length(nickname) BETWEEN 1 AND 30),
  photo_url           text,                                   -- armazenamento em aberto (questões em aberto #4)
  phone_e164          text UNIQUE,                            -- PII; nulo para convidado sem login (ACE-01)
  phone_verified_at   timestamptz,
  birth_date          date NOT NULL,                          -- PII; 15+ garantido pela aplicação (ACE-03)
  consent_status      consent_status NOT NULL DEFAULT 'not_required',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,                            -- exclusão de conta (ACE-06)
  CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
);

-- Responsável legal de usuário menor (ACE-04)
CREATE TABLE guardians (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,                                 -- PII
  phone_e164   text,                                          -- PII
  email        text,                                          -- PII
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (phone_e164 IS NOT NULL OR email IS NOT NULL)
);

-- Histórico de consentimentos; users.consent_status guarda o estado atual
CREATE TABLE consents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id),
  guardian_id     uuid NOT NULL REFERENCES guardians(id),
  status          consent_status NOT NULL,
  terms_version   text NOT NULL,                              -- versão dos termos aceitos
  requested_at    timestamptz NOT NULL DEFAULT now(),
  decided_at      timestamptz,
  revoked_at      timestamptz
);
CREATE INDEX consents_user_idx ON consents (user_id);

-- Códigos de login pelo WhatsApp (ACE-02); expirados são apagados por Cron
CREATE TABLE login_codes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164    text NOT NULL,                                -- PII
  code_hash     text NOT NULL,                                -- nunca o código em claro
  attempts      smallint NOT NULL DEFAULT 0,
  expires_at    timestamptz NOT NULL,                         -- criação + 10 min
  locked_until  timestamptz,                                  -- 5 tentativas erradas → 15 min
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_codes_phone_idx ON login_codes (phone_e164, created_at DESC);

-- Pedidos de código por IP, para o limite por IP (ACE-02); o Cron apaga após 1 h
CREATE TABLE login_ip_requests (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip_hash       text NOT NULL,                                -- PII pseudonimizada: HMAC do IP, nunca o IP em claro
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_ip_requests_ip_idx ON login_ip_requests (ip_hash, created_at DESC);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id),
  token_hash   text NOT NULL UNIQUE,                          -- cookie httpOnly guarda o token; aqui só o hash
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- Bloqueio entre usuários (SEG-02)
CREATE TABLE blocks (
  blocker_id   uuid NOT NULL REFERENCES users(id),
  blocked_id   uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX blocks_blocked_idx ON blocks (blocked_id);

-- ---------------------------------------------------------------------------
-- Grupos (GRP)
-- ---------------------------------------------------------------------------

CREATE TABLE groups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  photo_url     text,
  invite_code   text NOT NULL UNIQUE,                         -- código aleatório do link; sem busca (GRP-02)
  created_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE group_members (
  group_id      uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id),
  role          group_role NOT NULL DEFAULT 'member',
  status        membership_status NOT NULL DEFAULT 'pending',
  invited_by    uuid REFERENCES users(id),
  approved_by   uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX group_members_user_idx ON group_members (user_id);

-- ---------------------------------------------------------------------------
-- Resenhas (RES, LOC)
-- ---------------------------------------------------------------------------

CREATE TABLE resenhas (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id              uuid NOT NULL REFERENCES groups(id),
  organizer_id          uuid NOT NULL REFERENCES users(id),
  host_id               uuid REFERENCES users(id),            -- anfitrião, definido quando "onde" fecha
  name                  text CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 60),
  date                  date NOT NULL,
  starts_at             timestamptz,                          -- definido quando "horário" fecha
  neighborhood          text,                                 -- bairro; o único dado de local público (LOC-01)
  exact_address         text,                                 -- PII; só para aprovados e confirmados (LOC-02)
  invite_code           text NOT NULL UNIQUE,
  status                resenha_status NOT NULL DEFAULT 'open',
  split_model           split_model,                          -- definido quando "divisão" fecha (VOT-06)
  total_cost_cents      integer CHECK (total_cost_cents IS NULL OR total_cost_cents >= 0),  -- rateio (DIV-02)
  allow_suggestions     boolean NOT NULL DEFAULT true,        -- VOT-03
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  closed_at             timestamptz,                          -- RES-07
  address_purged_at     timestamptz                           -- preenchido quando o Cron apaga o endereço (LOC-03)
);
CREATE INDEX resenhas_group_idx ON resenhas (group_id, date DESC);
-- Fila do Cron de LOC-03: resenhas encerradas com endereço ainda presente
CREATE INDEX resenhas_address_purge_idx ON resenhas (closed_at)
  WHERE exact_address IS NOT NULL AND closed_at IS NOT NULL;

-- Quem está na resenha, com acesso e resposta (RES-03, RES-05, RES-06)
CREATE TABLE participations (
  resenha_id      uuid NOT NULL REFERENCES resenhas(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id),
  access          access_status NOT NULL DEFAULT 'pending',
  rsvp            rsvp,
  invite_source   text NOT NULL CHECK (invite_source IN ('group_link', 'resenha_link')),
  invited_by      uuid REFERENCES users(id),                  -- de quem era o link (RES-05)
  decided_by      uuid REFERENCES users(id),                  -- quem aprovou ou recusou
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (resenha_id, user_id)
);
CREATE INDEX participations_user_idx ON participations (user_id);

-- ---------------------------------------------------------------------------
-- Votações (VOT)
-- ---------------------------------------------------------------------------

CREATE TABLE polls (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resenha_id          uuid NOT NULL REFERENCES resenhas(id) ON DELETE CASCADE,
  kind                poll_kind NOT NULL,
  status              poll_status NOT NULL DEFAULT 'open',
  closes_at           timestamptz,                            -- prazo opcional (VOT-05)
  winning_option_id   uuid,                                   -- FK adicionada abaixo
  created_at          timestamptz NOT NULL DEFAULT now(),
  closed_at           timestamptz,
  UNIQUE (resenha_id, kind)                                   -- uma votação de cada tipo por resenha no MVP
);

CREATE TABLE poll_options (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id          uuid NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  label            text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
  split_model      split_model,                               -- preenchido só nas opções da votação 'split'
  suggested_by     uuid REFERENCES users(id),                 -- nulo = opção padrão do sistema
  offered_home_by  uuid REFERENCES users(id),                 -- "pode ser lá em casa" (DIV-04); só em 'where'
  neighborhood     text,                                      -- bairro exibido para opções de casa
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX poll_options_poll_idx ON poll_options (poll_id);

ALTER TABLE polls
  ADD CONSTRAINT polls_winning_option_fk
  FOREIGN KEY (winning_option_id) REFERENCES poll_options(id);

-- Um voto por pessoa por votação, trocável até fechar (VOT-04)
CREATE TABLE votes (
  poll_id      uuid NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id),
  option_id    uuid NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (poll_id, user_id)
);
CREATE INDEX votes_option_idx ON votes (option_id);

-- ---------------------------------------------------------------------------
-- Itens (DIV)
-- ---------------------------------------------------------------------------

CREATE TABLE items (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resenha_id             uuid NOT NULL REFERENCES resenhas(id) ON DELETE CASCADE,
  description            text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 60),
  owner_id               uuid REFERENCES users(id),           -- no máximo um responsável (DIV-01)
  estimated_cost_cents   integer CHECK (estimated_cost_cents IS NULL OR estimated_cost_cents >= 0),
  status                 item_status NOT NULL DEFAULT 'open', -- DIV-03
  created_by             uuid NOT NULL REFERENCES users(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX items_resenha_idx ON items (resenha_id);

-- ---------------------------------------------------------------------------
-- Segurança e moderação (SEG)
-- ---------------------------------------------------------------------------

-- Toda denúncia entra aqui, a fila da plataforma (SEG-01, SEG-04)
CREATE TABLE reports (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id    uuid NOT NULL REFERENCES users(id),
  target_type    report_target NOT NULL,
  target_id      uuid NOT NULL,                               -- id do usuário, conteúdo ou resenha
  resenha_id     uuid REFERENCES resenhas(id),                -- para o anfitrião ver as da resenha dele
  reason         text NOT NULL,                               -- lista de motivos definida na entrega 8
  details        text,                                        -- PII possível; nunca em log
  status         report_status NOT NULL DEFAULT 'open',
  decision       text,
  decided_by     uuid REFERENCES users(id),                   -- moderador da plataforma
  decided_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_queue_idx ON reports (status, created_at);
CREATE INDEX reports_resenha_idx ON reports (resenha_id);

-- Termos bloqueados para filtro de texto e regra de álcool (SEG-03, VOT-02)
CREATE TABLE blocked_terms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term        text NOT NULL,
  category    blocked_term_category NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (term, category)
);

-- ---------------------------------------------------------------------------
-- Métricas de produto (RNF-12) — sem dado pessoal nas propriedades
-- ---------------------------------------------------------------------------

CREATE TABLE events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name         text NOT NULL,                                 -- ex.: resenha_created, vote_cast, card_shared
  user_id      uuid REFERENCES users(id),
  resenha_id   uuid REFERENCES resenhas(id) ON DELETE SET NULL,
  properties   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_name_time_idx ON events (name, created_at);
