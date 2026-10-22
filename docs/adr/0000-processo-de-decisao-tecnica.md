# ADR 0000 — Processo de decisão técnica

- Status: Aceito
- Data: 2026-10-18
- Decisor: Ayabe (responsável pelo produto)

## Contexto

O código da Resenha é escrito por desenvolvedores e pelo Claude Code. Agentes tendem a escolher bibliotecas, serviços e padrões por conta própria, e cada escolha vira custo de manutenção. O responsável pelo produto quer que tendências e tecnologias novas sejam sempre trazidas por um arquiteto, engenheiro ou analista de P&D, com análise, para decisão consciente.

## Decisão

1. Toda decisão técnica relevante é registrada como ADR em `docs/adr/`, numerada em sequência (`NNNN-titulo-curto.md`), a partir do modelo `docs/adr/modelo.md`.
2. Quem propõe: arquiteto, engenheiro ou analista de P&D (pessoa ou o subagente `arquiteto-rd`). O ADR nasce com status `Proposto`.
3. Quem decide: o responsável pelo produto. O status passa a `Aceito` ou `Rejeitado`, com data e nome de quem decidiu. Só ADR `Aceito` pode ser implementado.
4. Uma decisão substituída não é apagada: o ADR antigo recebe status `Substituído por NNNN`. Uma proposta que o decisor quer discutir mais tarde recebe status `Adiado`, com a data e o motivo; a análise fica guardada e nada dela é implementado.
5. O radar tecnológico (`docs/radar-tecnologico.md`) registra tendências e alternativas em avaliação. Entrar no radar não autoriza uso; só um ADR aceito autoriza.
6. O que exige ADR está listado em `CLAUDE.md`, seção "Governança técnica".

## Consequências

- Nenhuma dependência de produção, serviço externo ou padrão novo entra sem análise registrada e aprovação.
- O Claude Code pode pesquisar e propor, mas não instalar nem implementar o que não foi aprovado.
- Decisões ficam rastreáveis para quem entrar no time depois.
