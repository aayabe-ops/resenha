# ADR 0002 — Banco de dados: Postgres na região São Paulo via Hyperdrive

- Status: Aceito
- Data: 2026-10-18
- Decisor: Ayabe

## Contexto

A maioria dos usuários é menor de idade, e o requisito RNF-11 pede dados no Brasil. O banco nativo do Cloudflare (D1) oferece apenas regiões na América do Norte, Europa, Ásia-Pacífico e Oceania; a América do Sul não é suportada ([documentação do D1, consultada em 18/10/2026](https://developers.cloudflare.com/d1/configuration/data-location/)).

## Opções consideradas

| Opção | Prós | Contras |
| --- | --- | --- |
| D1 (SQLite do Cloudflare) | Mais simples e barato, tudo no Cloudflare | Dados fora do Brasil; ~100 ms extras por consulta; SQLite |
| Postgres gerenciado em São Paulo via Hyperdrive | Dados no Brasil; Postgres é conhecido por quase todo dev; portável | Um provedor a mais; latência entre a borda e São Paulo |

## Decisão

Postgres gerenciado na região São Paulo, acessado pelo Hyperdrive, com Drizzle ORM e migrações versionadas no repositório. O schema de referência é `docs/db/schema.sql`.

O provedor específico (ex.: Supabase, Neon) é decidido num ADR próprio antes da entrega 1 (questão em aberto #5). Requisitos para o provedor: região São Paulo, Postgres 15+, compatível com Hyperdrive, backup automático e banco separado para staging.

## Consequências

- Dados de menores ficam no Brasil.
- Se a plataforma de execução mudar, o banco vai junto sem migração de tecnologia.
- Só os recursos padrão do Postgres são usados; nada específico de um provedor (ex.: Auth, Realtime ou Storage de um BaaS) sem novo ADR.
