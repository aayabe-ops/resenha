# ADR 0004 — Linguagem, frameworks e convenções de código

- Status: Aceito
- Data: 2026-10-18
- Decisor: Ayabe

## Contexto

O projeto vai ser tocado por desenvolvedores contratados depois e pelo Claude Code. A stack precisa ser a mais comum possível no mercado brasileiro e rodar no runtime do Workers.

## Decisão

- **TypeScript** em modo strict em todo o código.
- **React + Vite** para o front, como PWA.
- **Hono** para a API no Workers.
- **Drizzle ORM** e **Drizzle Kit** para schema e migrações.
- **Zod** para validação compartilhada (`packages/shared`).
- **Vitest** (com o pool de Workers) e **Playwright** para testes.
- **ESLint** e **Prettier** para estilo.
- Monorepo com **pnpm workspaces**: `apps/web`, `apps/api`, `packages/db`, `packages/shared`.
- Código, banco e identificadores em inglês; interface, documentação e commits em português. Glossário em `docs/db/modelo-de-dados.md`.

## Consequências

- Um só idioma de programação do front aos testes; fácil de contratar.
- Bibliotecas de UI, gerenciamento de estado, roteamento e afins além do React exigem ADR próprio quando forem necessárias.
