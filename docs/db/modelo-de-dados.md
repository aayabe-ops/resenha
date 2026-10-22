# Modelo de dados

O schema de referência é `docs/db/schema.sql` (Postgres 15+, validado em Postgres 16). Ele tem 18 tabelas em cinco blocos: pessoas e acesso, grupos, resenhas, votações e itens, segurança e métricas. A primeira migração do Drizzle reproduz esse arquivo; depois, toda mudança é feita por migração e refletida nele no mesmo PR.

## Glossário (domínio → código)

| Termo do produto | No código | Observação |
| --- | --- | --- |
| Usuário | `users` | Inclui o convidado sem login (ACE-01): `phone_e164` nulo |
| Pedido de código por IP | `login_ip_requests` | Só para o limite por IP do login (ACE-02) |
| Responsável legal | `guardians` | |
| Consentimento | `consents`, `users.consent_status` | Histórico e estado atual |
| Grupo | `groups` | |
| Membro do grupo | `group_members` | |
| Resenha | `resenhas` | Termo mantido sem tradução, é o nome do produto |
| Organizador | `resenhas.organizer_id` | |
| Anfitrião | `resenhas.host_id` | |
| Participação | `participations` | Acesso (aprovação) + resposta (Vou, Talvez, Não vou) |
| Votação | `polls` | Tipos: `where` (onde), `when` (horário), `split` (divisão) |
| Opção | `poll_options` | |
| Voto | `votes` | |
| Modelo de divisão | `split_model` | `equal_split` rateio · `each_brings` cada um leva · `own_drinks` só bebida · `each_their_own` cada um com o seu |
| Item | `items` | "Quem leva o quê" |
| Bairro | `neighborhood` | Único dado de local público |
| Endereço exato | `exact_address` | Restrito (LOC-02) |
| Denúncia | `reports` | Fila da plataforma |
| Bloqueio | `blocks` | |
| Termo bloqueado | `blocked_terms` | Categorias `alcohol` e `offensive` |
| Evento | `events` | Métricas de produto, sem dado pessoal |

## Regras que o banco sozinho não garante

A aplicação (Worker e Durable Object) é responsável por estas regras, cada uma coberta por teste:

- **Idade mínima:** recusar `birth_date` com menos de 15 anos antes de qualquer `INSERT` (ACE-03).
- **Menor de idade:** calculado a partir de `birth_date` no momento da consulta, nunca guardado, porque muda com o tempo.
- **Álcool:** se algum participante aprovado for menor, a opção `own_drinks` é substituída por `each_their_own` e itens com termos `alcohol` são recusados (VOT-02).
- **Endereço:** `exact_address` só é lido para participantes com `access = 'approved'` e `rsvp = 'going'`, ou para organizador e anfitrião (LOC-02).
- **Uma votação aberta só aceita votos de participantes aprovados**, e `votes.option_id` precisa pertencer a `votes.poll_id`.
- **`polls.winning_option_id`** precisa pertencer à própria votação.
- **Opções de `split`** sempre têm `split_model` preenchido; as de `where` e `when`, não.

## Retenção e apagamento

| Dado | Retenção | Como |
| --- | --- | --- |
| `resenhas.exact_address` | 24 h após `closed_at` | Cron zera o campo e preenche `address_purged_at` (LOC-03) |
| `login_codes` | Até expirar | Cron apaga expirados |
| `login_ip_requests` | 1 h (janela do limite por IP) | Cron apaga; guarda só o hash do IP |
| `sessions` | Até expirar ou ser revogada | Cron apaga expiradas |
| Dados pessoais de `users` | Até a exclusão da conta | Ver abaixo |
| `reports` | Em aberto (questão #7) | Definido pelo jurídico |
| `events` | Sem dado pessoal | Sem prazo no MVP |

## Exclusão de conta (ACE-06)

A exclusão não apaga a linha de `users`, para não quebrar votos, itens e histórico dos amigos. Em até 24 h:

1. `nickname` vira "ex-participante"; `photo_url`, `phone_e164` e `phone_verified_at` viram nulos; `birth_date` vira uma data neutra que mantém só a faixa (menor ou maior): para quem é menor, 31 de dezembro do ano de nascimento (assim a pessoa nunca passa a contar como maior antes da hora, e a regra de álcool continua valendo); para quem é maior, 1º de janeiro de 1900. `deleted_at` é preenchido.
2. Sessões são revogadas e códigos de login apagados.
3. Se o usuário for o único admin de um grupo, a administração passa ao membro aprovado mais antigo.

O tratamento de `birth_date` na exclusão depende do parecer jurídico (questão #2) e pode mudar.

## O que entra na fase 2

Fotos do feed (expiram em 24 h, no R2), reações, apostas e disponibilidade ("tá on hoje"). Cada uma entra por migração própria quando a fase começar.
