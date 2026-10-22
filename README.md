# Resenha

Web app para a galera combinar resenhas: cria, manda o link no grupo, todo mundo vota onde, que horas e quem leva o quê, e sai um card pronto para voltar ao WhatsApp.

Status: especificação pronta, desenvolvimento do MVP começando pela entrega 1 (fundação).

- Comece por [`CLAUDE.md`](CLAUDE.md): regras do repositório, para pessoas e agentes.
- Produto e requisitos: [`docs/requisitos.md`](docs/requisitos.md)
- Especificação técnica: [`docs/spec.md`](docs/spec.md)
- Decisões de arquitetura: [`docs/adr/`](docs/adr/)

## Rodando localmente

Pré-requisitos: pnpm 9 e Docker. O Node 24 do projeto é baixado pelo próprio pnpm (`.npmrc`); não precisa trocar o Node da máquina.

```sh
pnpm install
cp .env.example .env     # opcional: valores padrão já apontam para o Postgres local
pnpm db:up               # Postgres 16 em container
pnpm db:migrate          # aplica as migrações do Drizzle
pnpm dev                 # web em http://localhost:5173 (com /api encaminhado ao Wrangler)
```

| Comando | O que faz |
| --- | --- |
| `pnpm dev` | Vite (com recarga) + `wrangler dev` da API em paralelo. Use http://localhost:5173; a porta 8787 serve só `/api/*` |
| `pnpm start` | Build do PWA e um único Worker servindo site e API em http://localhost:8787 |
| `pnpm lint` | ESLint, Prettier e checagem de tipos |
| `pnpm test` | Testes (precisa do `pnpm db:up` para o teste do schema) |
| `pnpm db:generate` | Gera migração a partir do schema Drizzle (`packages/db/src/schema`) |
| `pnpm db:down` | Para o Postgres (os dados ficam no volume) |
