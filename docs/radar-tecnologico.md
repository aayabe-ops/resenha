# Radar tecnológico

Mantido pelo arquiteto ou analista de P&D (pessoa ou subagente `arquiteto-rd`). Mostra o que usamos, o que está em avaliação e o que evitamos. Entrar no radar não autoriza uso: só um ADR com status `Aceito` autoriza (ADR 0000).

Revisão sugerida: a cada fim de fase ou quando surgir uma necessidade nova.

## Anéis

- **Adotar:** aprovado por ADR e em uso.
- **Experimentar:** ADR aceito para teste limitado (protótipo, uma entrega, uma fatia de usuários).
- **Avaliar:** vale estudar; precisa de proposta de ADR antes de qualquer uso.
- **Evitar:** analisado e descartado para este projeto, com motivo.

## Itens

| Tecnologia | Anel | Área | Motivo / próximo passo | Referência |
| --- | --- | --- | --- | --- |
| Cloudflare Workers, Durable Objects, Hyperdrive, Queues, Turnstile | Adotar | Plataforma | Base do MVP | ADR 0001 |
| Postgres gerenciado em São Paulo | Adotar | Dados | Dados de menores no Brasil | ADR 0002 |
| `pg` (node-postgres) como driver de runtime, via `drizzle-orm/node-postgres` e Hyperdrive | Adotar | Dados | Driver do Worker e dos Durable Objects a partir da entrega 2; já usado nas migrações | ADR 0007 |
| Drizzle ORM | Adotar | Dados | Schema tipado e migrações | ADR 0004 |
| WhatsApp Cloud API (autenticação) | Adotar | Acesso | Login sem senha | ADR 0003 |
| TypeScript, React + Vite, Hono, Zod, Vitest, Playwright, pnpm | Adotar | Código | Stack comum no mercado | ADR 0004 |
| R2 | Avaliar | Arquivos | Fase 2 para o feed; avaliar antecipar para fotos de perfil | Questão em aberto #4 |
| Neon (Postgres em `aws-sa-east-1`) | Avaliar | Dados | Recomendado como provedor; decisão adiada até definir a hospedagem | ADR 0005 (Adiado) |
| Supabase (Postgres em `sa-east-1`) | Avaliar | Dados | Alternativa ao Neon; recursos de plataforma não seriam usados | ADR 0005 (Adiado) |
| Workers Logs + Workers Issues | Avaliar | Observabilidade | Recomendado; decisão adiada até definir a hospedagem | ADR 0006 (Adiado) |
| Sentry (região UE) | Avaliar | Observabilidade | Reavaliar antes do lançamento público, se faltar alerta | ADR 0006 (Adiado) |
| Moderação automática de imagens | Avaliar | Segurança | Necessária na fase 2 (SEG-05) | Requisitos |
| `postgres` (postgres.js) como driver de runtime | Evitar | Dados | A Cloudflare não suporta Drizzle + Postgres.js sobre Hyperdrive | ADR 0007 |
| Drivers serverless de provedor (ex.: `@neondatabase/serverless`) | Evitar | Dados | Contornam o Hyperdrive e amarram a um provedor | ADR 0007 |
| Cloudflare D1 | Evitar | Dados | Não roda na América do Sul | ADR 0002 |
| Recursos proprietários de BaaS (Auth, Realtime, Storage de um provedor) | Evitar | Dados | Lock-in; o MVP usa só Postgres padrão | ADR 0002 |
