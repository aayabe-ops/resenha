# ADR 0006 — Ferramenta de erros e observabilidade

- Status: Proposto
- Data da proposta: 2026-10-21
- Proposto por: Claude, no papel de arquiteto / analista de P&D
- Decisor: Ayabe · pendente

## Contexto

A spec citava Sentry, mas a escolha ficou em aberto (questão #11) e bloqueia a entrega 1. O ponto sensível: ferramentas de erro recebem pedaços de requisição, usuário e contexto, e aqui a maioria dos usuários é menor de idade. A regra de `CLAUDE.md` proíbe dado pessoal em log, e o RNF-11 quer dados no Brasil.

## Opções consideradas

| Opção | Onde ficam os dados | Preço | O que cobre | Pontos de atenção |
| --- | --- | --- | --- | --- |
| A — Nativo do Cloudflare: Workers Logs + Workers Issues | Na conta Cloudflare; a documentação não informa a região de armazenamento | Plano pago: 20 milhões de eventos/mês incluídos, depois US$ 0,60 por milhão; retenção de 7 dias. Cobrança muda para o modelo Cloudflare Observability em 01/12/2026 | Logs, exceções não tratadas, agrupamento de erros (Issues), source maps; exporta por OpenTelemetry | Só cobre o servidor (Workers e Durable Objects); a documentação não descreve alertas de erro |
| B — Sentry (SDK `@sentry/cloudflare`), região UE | Estados Unidos ou União Europeia (Frankfurt); sem opção na América do Sul; não dá para trocar depois de criar a organização | Grátis: 5 mil erros, 1 usuário, 30 dias. Team: US$ 29/mês, 50 mil erros, 90 dias | Servidor (Workers e Durable Objects) e front; alertas, releases, agrupamento maduro | Por padrão coleta IP, ID de usuário, corpo de requisição e query string: precisa desligar; transferência internacional de dados de menores precisa de aval jurídico |
| C — A agora, B depois | A no MVP; B avaliado antes do lançamento público | — | — | — |

Fontes (consultadas em 21/10/2026):

- [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) e [preços do Cloudflare Observability](https://developers.cloudflare.com/observability/pricing/)
- [Sentry — SDK para Cloudflare](https://docs.sentry.io/platforms/javascript/guides/cloudflare/), [local de armazenamento](https://docs.sentry.io/organization/data-storage-location/) e [preços](https://sentry.io/pricing/)

## Recomendação

**Opção C: começar só com o nativo do Cloudflare e reavaliar o Sentry antes do lançamento público.**

1. **Nenhum terceiro novo recebendo dados de menores** no MVP; nada sai do Cloudflare, que já processa todas as requisições.
2. **Custo zero adicional** dentro do plano pago do Workers no volume do piloto.
3. **Cobre o essencial** do MVP: exceções agrupadas e logs de servidor, onde está quase toda a lógica.

Para os erros do front (React), sem biblioteca nova: um endpoint próprio `POST /api/client-errors` recebe mensagem, stack e rota, sem dados de usuário, e registra no Workers Logs. É código dentro da arquitetura aprovada.

Regras de log para qualquer opção: nunca registrar corpo de requisição, celular, endereço, nascimento, nome de responsável ou texto de denúncia; IDs internos (UUID) podem ser registrados.

A recomendação muda se: o piloto mostrar que falta alerta proativo de erro (aí vale o Sentry na região UE, com coleta de dados de usuário desligada e aval jurídico), ou se a cobrança do Cloudflare Observability a partir de 01/12/2026 encarecer muito.

## Impactos

- Runtime do Workers: nativo, nenhuma biblioteca nova.
- Dados de menores: ficam no Cloudflare; a região de armazenamento dos logs não está documentada, a confirmar com o Cloudflare se o jurídico exigir.
- Custo: incluso no plano pago do Workers no volume do piloto.
- Saída: exportação por OpenTelemetry permite trocar de ferramenta depois.
- Lacuna conhecida: sem alertas automáticos documentados; acompanhar o painel na rotina do time durante o piloto.

## Decisão

Pendente.
