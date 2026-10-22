# ADR 0005 — Provedor do Postgres gerenciado em São Paulo

- Status: Proposto
- Data da proposta: 2026-10-21
- Proposto por: Claude, no papel de arquiteto / analista de P&D
- Decisor: Ayabe · pendente

## Contexto

O ADR 0002 decidiu por Postgres gerenciado na região São Paulo, acessado pelo Hyperdrive, usando só recursos padrão do Postgres. Falta escolher o provedor (questão em aberto #5), o que bloqueia a entrega 1.

Requisitos para o provedor (ADR 0002 e `docs/spec.md`):

- região São Paulo (AWS `sa-east-1`), por causa dos dados de menores (RNF-11);
- Postgres 15+ e compatível com o Hyperdrive;
- backup automático;
- banco separado para os previews de PR (spec, seção 6);
- custo baixo no piloto, sem travar o crescimento.

## Opções consideradas

| Opção | Região São Paulo | Preço | Backups / restauração | Bancos para preview de PR | Observações |
| --- | --- | --- | --- | --- | --- |
| A — Neon (plano Launch) | Sim, `aws-sa-east-1`, GA desde 28/02/2025 | Sem mínimo mensal; US$ 0,106 por CU-hora; armazenamento US$ 0,35/GB-mês | Restauração a qualquer ponto em até 7 dias | Branches de banco: 10 por projeto incluídos, extras a US$ 1,50/branch-mês | Escala a zero após 5 min (pode desligar na produção); Postgres puro |
| B — Supabase (plano Pro) | Sim, `sa-east-1` | US$ 25/mês com US$ 10 de crédito de compute (cobre uma instância Micro de 1 GB); projeto extra a partir de US$ 10/mês | Backup diário com 7 dias; restauração a qualquer ponto custa US$ 100/mês por 7 dias | Um projeto extra para staging (+US$ 10/mês) | Plataforma completa (Auth, Realtime, Storage), mas o ADR 0002 proíbe usar esses recursos; plano grátis pausa após 1 semana sem uso e não tem backup |
| C — AWS RDS em `sa-east-1` | Sim | Por instância, sempre ligada | Snapshots e restauração a qualquer ponto | Instância extra ou snapshot | Mais trabalho de operação (rede, parâmetros, atualizações); faz sentido com time de infraestrutura |

Fontes (consultadas em 21/10/2026):

- [Neon — regiões](https://neon.com/docs/introduction/regions) e [changelog de 28/02/2025, São Paulo GA](https://neon.com/docs/changelog/2025-02-28)
- [Neon — preços](https://neon.com/pricing)
- [Supabase — preços](https://supabase.com/pricing) e [regiões](https://supabase.com/docs/guides/platform/regions)
- [Hyperdrive — bancos e provedores suportados](https://developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/) (lista Neon e Supabase como compatíveis; não suporta `PREPARE` em SQL, advisory locks, `LISTEN`/`NOTIFY`)

## Estimativa de custo no piloto

Estimativa minha, não cotação: produção sempre ligada com a menor unidade de compute (0,25 CU) dá cerca de 182 CU-horas no mês.

| Opção | Produção | Previews de PR | Total estimado |
| --- | --- | --- | --- |
| Neon Launch | ~US$ 19 de compute + centavos de armazenamento | Branches que escalam a zero; poucos dólares | ~US$ 20 a 25/mês |
| Supabase Pro | US$ 25 (Micro incluída) | +US$ 10 (projeto de staging) | ~US$ 35/mês, ou ~US$ 135 com restauração a qualquer ponto |

## Recomendação

**Neon, plano Launch, região `aws-sa-east-1`.**

1. **Branches de banco por PR** casam exatamente com o fluxo da spec (preview por PR com banco próprio), sem projeto extra.
2. **Postgres puro**, sem recursos de plataforma que o ADR 0002 já proíbe usar; o que pagaríamos a mais no Supabase não seria usado.
3. **Custo proporcional ao uso** no piloto, e restauração a qualquer ponto em até 7 dias incluída.

A recomendação muda se: o time decidir usar recursos prontos de uma plataforma (aí o Supabase se paga), ou se a latência de "acordar" o banco após escala a zero atrapalhar os previews (dá para desligar a escala a zero).

## Impactos

- Runtime do Workers: compatível via Hyperdrive; evitar `PREPARE`, advisory locks e `LISTEN`/`NOTIFY`, que o Hyperdrive não suporta.
- Dados de menores: ficam em São Paulo; produção com escala a zero desligada.
- Custo: ~US$ 20 a 25/mês no piloto (estimativa).
- Saída: Postgres padrão, migração para qualquer provedor por dump e restore.
- Contratação: Postgres é conhecido por praticamente todo dev.

## Decisão

Pendente.
