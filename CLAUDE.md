# CLAUDE.md — Resenha

Este arquivo orienta qualquer pessoa ou agente (inclusive o Claude Code) que trabalhe neste repositório. Leia inteiro antes de começar qualquer tarefa.

## O que é a Resenha

Web app (PWA) para adolescentes e jovens de 15 a 19 anos combinarem resenhas (rolês pequenos e frequentes) com o grupo de amigos. O organizador cria a resenha, manda o link no WhatsApp, a galera vota onde, que horas e o modelo de divisão, se oferece para levar coisas, e o app gera um card com o resultado que volta para o grupo.

A maior parte dos usuários é menor de idade. Segurança e conformidade (ECA Digital e LGPD) são requisitos do MVP, não melhorias futuras.

## Fontes da verdade

Tudo o que você precisa saber está em `docs/`. Se não está lá, não existe ainda.

| Arquivo | O que tem |
| --- | --- |
| `docs/requisitos.md` | Produto, requisitos funcionais (IDs ACE, GRP, RES, VOT, DIV, CRD, LOC, ZOE, SEG) e não funcionais (RNF) |
| `docs/spec.md` | Stack, arquitetura, entregas do MVP em ordem, critérios de aceite, convenções |
| `docs/db/schema.sql` | Schema do banco de referência (o Drizzle deve reproduzi-lo) |
| `docs/db/modelo-de-dados.md` | Explicação do schema, glossário e retenção de dados |
| `docs/adr/` | Decisões de arquitetura aprovadas (ADRs) |
| `docs/radar-tecnologico.md` | Tecnologias em uso, em avaliação e evitadas |
| `docs/questoes-em-aberto.md` | O que ainda não foi decidido |

## Regra de ouro: não invente

1. Implemente só o que está em `docs/`. Não crie funcionalidade, tela, campo, regra de negócio ou texto de produto que não esteja descrito.
2. Se faltar informação para continuar, **pare e pergunte**. Se não houver ninguém para perguntar, registre a dúvida em `docs/questoes-em-aberto.md` e siga só com o que não depende dela.
3. Se encontrar contradição entre documentos, não escolha um lado: aponte a contradição e pergunte.
4. Textos de interface que não estejam nos docs: escreva uma proposta e marque com `// TODO(copy): revisar` para revisão humana.

## Governança técnica: quem decide tecnologia

A stack está fechada (ver `docs/spec.md` e ADRs 0001 a 0004). **O Claude Code não escolhe tecnologia.** Decisões técnicas são propostas por um arquiteto, engenheiro ou analista de P&D e aprovadas pelo responsável do produto (Ayabe).

Exige um ADR aprovado (status `Aceito`) antes de entrar no código:

- nova dependência de produção (`dependencies` em qualquer `package.json`);
- novo serviço externo, banco, fila, provedor ou API de terceiros;
- novo framework, biblioteca de UI, ORM, padrão de arquitetura ou estrutura de pastas;
- mudança em qualquer item da stack ou em decisão já registrada em ADR.

Não exige ADR: dependências de desenvolvimento já aprovadas no ADR 0004 e em `docs/spec.md` (TypeScript, Vite, Vitest, Playwright, Wrangler, Drizzle Kit, ESLint, Prettier) e código próprio dentro da arquitetura aprovada. Bibliotecas de produção aprovadas: React, Hono, Drizzle ORM, Zod e as que um ADR aceito listar.

Quando você achar que uma tecnologia nova resolveria melhor um problema:

1. Não instale nem implemente.
2. Use o subagente `arquiteto-rd` (`.claude/agents/arquiteto-rd.md`) para pesquisar e escrever a proposta em `docs/adr/` com status `Proposto`.
3. Avise o responsável e siga com a solução da stack atual, ou pare se não houver caminho.

O arquiteto também mantém `docs/radar-tecnologico.md`, onde tendências e alternativas ficam registradas para decisão.

## Regras invioláveis de segurança e proteção de menores

Qualquer código que quebre uma destas regras é um bug grave, mesmo que um requisito pareça pedir o contrário. Nesse caso, pare e pergunte.

- **Endereço exato** só sai da API para participantes aprovados e confirmados (LOC-01, LOC-02). Nunca aparece em card, prévia de link, log ou notificação. É apagado 24 h após o encerramento (LOC-03).
- **Celular e data de nascimento** nunca saem da API para outros usuários.
- **Nenhum dado pessoal em log** (celular, endereço, nascimento, nome do responsável, conteúdo de denúncia).
- **Idade mínima de 15 anos.** Abaixo disso, o cadastro é recusado sem gravar dados pessoais.
- **Sem álcool para menores:** se houver participante menor, o modelo "só bebida" vira "cada um com o seu" e itens alcoólicos são bloqueados.
- **Nada sobre pessoas:** votações, apostas e troféus nunca têm uma pessoa como opção ou alvo. Nada anônimo entre pessoas.
- **Nada encontrável por busca:** grupos, resenhas e perfis só por link e aprovação.
- **Toda denúncia vai para a fila da plataforma**, além do que o anfitrião vê.
- Toda checagem de permissão acontece no servidor. O front nunca é a barreira.

## Stack (resumo; detalhes em `docs/spec.md`)

TypeScript strict · React + Vite (PWA) servido pelo Cloudflare Workers · API Hono no Workers · Durable Objects com WebSocket (um por resenha) · Postgres gerenciado na região São Paulo via Hyperdrive · Drizzle ORM com migrações versionadas · login por código no WhatsApp Cloud API · Turnstile · Queues e Cron Triggers · Vitest (pool de Workers) e Playwright · monorepo com pnpm workspaces · GitHub Actions + Wrangler.

Ainda não decidido (não escolha por conta própria): hospedagem e deploy, provedor do Postgres, armazenamento de fotos de perfil, ferramenta de erros. Ver `docs/questoes-em-aberto.md`.

**Fase atual: desenvolvimento local.** Tudo roda na máquina (Wrangler + Postgres em container). Não crie deploy, contas, segredos de nuvem nem configuração de produção. Login pelo WhatsApp e Turnstile usam modo de desenvolvimento (código exibido no console, chave de teste) até a hospedagem ser decidida.

O runtime do Workers não é Node.js completo. Antes de usar qualquer API ou biblioteca, confirme que roda no Workers.

## Estrutura do repositório

```
apps/web         React + Vite (PWA)
apps/api         Hono + Durable Objects
packages/db      schema Drizzle e migrações
packages/shared  tipos e validação (Zod) compartilhados
docs/            fonte da verdade do produto e da arquitetura
```

O código existe desde a entrega 1. As entregas concluídas e as que faltam estão em `docs/spec.md`, seção 4; o que ainda não foi decidido, em `docs/questoes-em-aberto.md`.

## Convenções

- Código, nomes de tabelas, colunas e variáveis em inglês. Interface, docs e mensagens de commit em português. A tradução dos termos de domínio está no glossário de `docs/db/modelo-de-dados.md`.
- Um branch e um PR por entrega (`docs/spec.md`, seção 4). A descrição do PR lista os IDs de requisito atendidos.
- Cada critério de aceite (`docs/spec.md`, seção 5) vira ao menos um teste automatizado.
- Toda mudança de schema é feita por migração e reflete em `docs/db/schema.sql`.
- Segredos só em Wrangler secrets e GitHub Actions secrets. Nunca no código nem em `.env` versionado.

## Git e GitHub: sempre subir o trabalho

Repositório: `https://github.com/aayabe-ops/resenha`. Todo trabalho fica no GitHub, nunca só na máquina.

- Antes de começar: `git pull` no `main` e crie o branch da entrega (`entrega-N-nome-curto`, ex.: `entrega-1-fundacao`).
- Commits pequenos, em português, um por passo concluído; faça `git push` logo após cada commit.
- Nunca faça push direto no `main` e nunca faça merge: abra um PR do branch para o `main` e espere a aprovação do responsável.
- Ao terminar a sessão, confirme que não há nada sem commit ou sem push (`git status` limpo e branch em dia com o remoto).
- Se o push falhar, pare e avise; não apague nem reescreva histórico (`--force`, `reset --hard`) para contornar.

## Como trabalhar uma entrega

1. Leia a entrega em `docs/spec.md` e os requisitos e critérios de aceite citados.
2. Apresente um plano curto e o que precisa do responsável (contas, segredos, IDs). Espere aprovação.
3. Implemente com testes. Rode testes e lint antes de abrir o PR.
4. No PR, liste os IDs atendidos, o que ficou fora e qualquer dúvida registrada em `docs/questoes-em-aberto.md`.
