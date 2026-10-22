# ADR 0007 — Driver do Postgres em tempo de execução (Worker e Durable Objects)

- Status: Proposto
- Data da proposta: 2026-10-21
- Proposto por: Claude, no papel de arquiteto / analista de P&D
- Decisor: Ayabe · pendente

## Contexto

A entrega 2 (Acesso, ACE-01 a ACE-06) traz a primeira rota que lê e grava no banco: código de login e tentativas (ACE-02), cadastro com nascimento (ACE-03, ACE-04), perfil (ACE-05) e exclusão de conta (ACE-06). Hoje o Worker não tem como falar com o Postgres: falta escolher o driver usado em tempo de execução (questão em aberto #12).

O que já está decidido e limita a escolha:

- ADR 0001 e 0002: Workers e Durable Objects (um por resenha) acessam o Postgres **via Hyperdrive**, usando só recursos padrão do Postgres, sem nada específico de provedor.
- ADR 0004: Drizzle ORM (`drizzle-orm` 0.45.4 no repositório), com o schema em `packages/db/src/schema`.
- `docs/spec.md`, seção 6: no local a conexão é direta, com o Postgres 16 do Docker Compose, e nada pode depender de nuvem para rodar. ADR 0005 (provedor) e 0006 estão adiados; não existe conta nem Hyperdrive de produção.
- Versões no repositório: wrangler 4.151.3, `@cloudflare/vitest-plugin` 1.4.6, Node 24, `compatibility_date` 2026-10-01 em `apps/api/wrangler.jsonc`.

**Sobre o `pg` que já está no repositório:** na entrega 1, `pg` (node-postgres) entrou só como `devDependency` de `packages/db`, para o `drizzle-kit migrate` e para o teste que compara a migração com `docs/db/schema.sql`. Esse código roda em Node, fora do Worker. **Isso não decide o driver de runtime**: colocar um driver em `dependencies` de um pacote que roda no Worker é dependência de produção nova e exige este ADR aceito (`CLAUDE.md`, "Governança técnica").

Critérios: compatibilidade oficial com o Hyperdrive e o que a Cloudflare recomenda; funcionamento no `wrangler dev` contra o Postgres do Docker, sem conta de nuvem; uso dentro de Durable Objects; comportamento com as limitações do Hyperdrive; transações; tamanho no bundle; manutenção e popularidade; testes com Vitest no runtime do Workers; dados de menores; custo; lock-in; facilidade de contratar.

## Opções consideradas

| Opção | Prós | Contras | Custo estimado | Maturidade |
| --- | --- | --- | --- | --- |
| A — manter o que existe (nenhum driver de runtime) | Nenhuma dependência nova | **Inviável para a entrega 2**: sem driver, o Worker não lê nem grava no Postgres, e todo o ACE-02 a ACE-06 depende disso. Contornar (guardar dados no storage do Durable Object ou num proxy HTTP próprio) contraria o ADR 0002, que faz do Postgres a fonte da verdade, ou cria um serviço novo | — | — |
| B — `pg` (node-postgres) via `drizzle-orm/node-postgres` | Driver **recomendado pela Cloudflare** para Hyperdrive, "melhor compatibilidade com o cache do Hyperdrive"; é o driver do exemplo oficial de Drizzle + Hyperdrive; já é usado no repositório (migrações e teste do schema), então é um driver só para tudo; transações interativas do Drizzle funcionam no mesmo `Client`; o pacote tem um módulo próprio para Workers (`pg-cloudflare`); o driver Postgres mais baixado do npm | Depende de `nodejs_compat` (já ligado por padrão na nossa `compatibility_date`); bundle um pouco maior que o do postgres.js; 6 dependências diretas (uma opcional, `pg-cloudflare`), todas do mesmo projeto ou pequenas | Zero (licença MIT) | Muito alta: 40,1 milhões de downloads na semana de 12 a 18/10/2026; 10 versões publicadas em 2026, a última (8.23.1) em 30/09/2026 |
| C — `postgres` (postgres.js) via `drizzle-orm/postgres-js` | Suportado pelo Hyperdrive (mínimo 3.4.5); sem dependências; bundle menor; tem build próprio para Workers (`workerd`) | **A Cloudflare diz que Drizzle + Postgres.js sobre Hyperdrive "não é suportado no momento"** (aviso de problema conhecido). Motivo provável, verificado no código: o adaptador do Drizzle chama o postgres.js com `prepare: false` em toda consulta sem nome, e a Cloudflare avisa que `prepare: false` pode fazer consultas travarem ou falharem de forma intermitente no modo de pool por transação. Usar postgres.js sem Drizzle contraria o ADR 0004 | Zero (licença Unlicense) | Alta: 14,3 milhões de downloads na mesma semana; última versão 3.4.9 em 05/04/2026, cadência mais lenta |
| D — driver serverless de provedor (`@neondatabase/serverless`, via `drizzle-orm/neon-serverless` ou `neon-http`) | Feito para edge; não precisa de `nodejs_compat` para o modo HTTP | **Não passa pelo Hyperdrive**: fala HTTP ou WebSocket com o proxy da Neon, o que contraria o ADR 0001/0002 (acesso via Hyperdrive) e amarra o código a um provedor ainda não escolhido (ADR 0005 adiado); no local exige rodar o proxy da Neon em container junto do Postgres; o modo HTTP não tem transação interativa | Zero o driver; amarra ao preço da Neon | Alta: 2,96 milhões de downloads na mesma semana |

Fora do escopo: trocar o Drizzle por outro ORM ou query builder (Kysely, Prisma); isso mexeria no ADR 0004.

### Comparação pelos critérios

| Critério | B — `pg` | C — postgres.js | D — Neon serverless |
| --- | --- | --- | --- |
| Hyperdrive, segundo a Cloudflare | Recomendado; mínimo `pg@8.16.3` | Suportado (mínimo 3.4.5), mas **não com Drizzle** | Não se aplica: contorna o Hyperdrive |
| `wrangler dev` local contra o Postgres do Docker, sem conta | Sim, pelo `localConnectionString` do binding (detalhes abaixo) | Sim, mesmo mecanismo | Só com o proxy local da Neon em container |
| Durable Objects | `Client` criado por invocação; conexão liberada ao hibernar | Igual | WebSocket não sobrevive à requisição; HTTP por consulta |
| Transações (`db.transaction`) | Interativas, no mesmo `Client`; savepoints aninhados | Interativas (`sql.begin`), mas o problema do `prepare: false` continua | Só no modo WebSocket |
| Bundle (estimativa, Bundlephobia) | ~84 KB minificado, ~26 KB gzip | ~37 KB minificado, ~14 KB gzip | não medido |
| Vitest no runtime do Workers | O binding Hyperdrive com conexão local chega aos testes (verificado no código do plugin); o próprio `pg` usa `@cloudflare/vitest-pool-workers` nos testes dele | Mesmo mecanismo do binding | Exigiria o proxy da Neon também no CI |

### Como o Hyperdrive se comporta e o que isso exige do código

Fatos da documentação do Hyperdrive, válidos para qualquer driver:

- O pool funciona **em modo transação**: cada transação segura uma conexão até terminar, e a conexão é devolvida com `RESET`. Um `SET` fora de transação não persiste para a consulta seguinte.
- **Não suportado:** `PREPARE`, `EXECUTE`, `DEALLOCATE` e `DISCARD` em SQL; advisory locks; `LISTEN`/`NOTIFY`; qualquer outro estado de sessão não documentado. Prepared statements **do protocolo** (com nome) funcionam com `pg` e postgres.js.
- **Cache de leitura ligado por padrão**, com `max_age` de 60 s e `stale_while_revalidate` de 15 s. Escritas não são cacheadas; o cache não é invalidado quando a aplicação grava. Consultas com `NOW()`, `RANDOM()` e afins não são cacheadas.
- Clientes devem ser criados **dentro do handler** (`fetch`, `queue`, etc.). Um cliente no escopo global fica inválido e gera erros nas requisições seguintes. Não é preciso chamar `client.end()`: a conexão com o Hyperdrive é limpa ao fim da invocação, inclusive quando um Durable Object hiberna ou é removido por inatividade.
- Durable Objects podem manter um cliente aberto entre requisições, mas a conexão continua alocada no pool, e muitos objetos assim esgotam as conexões (cerca de 20 no plano Free e 100 no Paid por configuração).
- Transações devem ser curtas, sem chamadas externas no meio.

Como o `pg` com Drizzle lida com isso (verificado no código do `drizzle-orm` 0.45.4 instalado):

- `drizzle-orm/node-postgres` só manda prepared statement com nome quando o código usa `.prepare('nome')`; nas demais, consulta parametrizada sem nome. As duas formas funcionam no Hyperdrive.
- `db.transaction()` roda `BEGIN`/`COMMIT` no mesmo `Client`; com `Pool`, pega um cliente do pool e o devolve no fim. Savepoints com `tx.transaction()`.
- O Drizzle não usa advisory locks, `LISTEN`/`NOTIFY` nem `PREPARE` em SQL nas consultas da aplicação.

**Ponto de atenção: no local nada disso é emulado.** Com `localConnectionString`, o Worker fala direto com o Postgres, sem pool por transação e sem cache. Um `SET` fora de transação, um advisory lock ou uma leitura que depende de dado recém-gravado funcionam no local e nos testes, e só falham com o Hyperdrive real. Por isso a recomendação traz regras de código desde a entrega 2.

### Configuração do binding para desenvolvimento local (verificado no código do wrangler 4.151.3)

- O binding vai em `apps/api/wrangler.jsonc`, com `binding`, `id` e `localConnectionString` (por exemplo, `postgres://resenha:resenha@localhost:5432/resenha`, o mesmo padrão do `docker-compose.yml` e do `drizzle.config.ts`).
- A variável de ambiente `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_<BINDING>` tem precedência sobre o arquivo (o prefixo `WRANGLER_...` antigo ainda funciona, com aviso). No CI, ela pode receber o `DATABASE_URL` que o job de testes já define.
- No modo local, se nenhuma das duas existir, o wrangler para com erro pedindo a conexão local.
- O validador do wrangler **exige o campo `id`** mesmo no local. A documentação não diz se é preciso conta; pelo código, no modo local o binding é atendido pelo Miniflare (`hyperdrive: "local-only"`), sem consultar a conta. **Não confirmei rodando** que um `id` fictício funciona sem login.
- O `@cloudflare/vitest-plugin` monta os bindings pela mesma função do wrangler (`unstable_getMiniflareWorkerOptions`), que aplica a variável de ambiente e o `localConnectionString`. Então os testes de API no runtime do Workers usam o Postgres local ou o do CI.
- `nodejs_compat`: para `compatibility_date` a partir de 2026-08-04, o Workers liga `nodejs_compat` e `nodejs_compat_v2` por padrão. A nossa é 2026-10-01, então nada precisa mudar. Declarar a flag explicitamente, como fazem os exemplos da Cloudflare, é opcional.

### Fontes (consultadas em 21/10/2026)

- [Hyperdrive — Connect to PostgreSQL](https://developers.cloudflare.com/hyperdrive/configuration/connect-to-postgres/): drivers suportados, versões mínimas, recomendação do `pg`, `nodejs_compat` por padrão a partir de 2026-08-04
- [Hyperdrive — node-postgres](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/): mínimo 8.16.3, "melhor compatibilidade com o cache", cliente por requisição
- [Hyperdrive — Postgres.js](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/postgres-js/): mínimo 3.4.5, `max: 5`, aviso sobre `prepare: false`
- [Hyperdrive — Drizzle ORM](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/drizzle-orm/): usa `drizzle-orm/node-postgres`; problema conhecido com Postgres.js
- [Hyperdrive — Supported databases and features](https://developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/): recursos não suportados
- [Hyperdrive — How Hyperdrive works](https://developers.cloudflare.com/hyperdrive/concepts/how-hyperdrive-works/): modo transação, `SET`, prepared statements com nome
- [Hyperdrive — Connection lifecycle](https://developers.cloudflare.com/hyperdrive/concepts/connection-lifecycle/): cliente no handler, Durable Objects, limpeza automática
- [Hyperdrive — Query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/): cache ligado por padrão, 60 s
- [Hyperdrive — Local development](https://developers.cloudflare.com/hyperdrive/configuration/local-development/) e [limites](https://developers.cloudflare.com/hyperdrive/platform/limits/) e [changelog](https://developers.cloudflare.com/hyperdrive/changelog/)
- [Workers — Compatibility flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/) e [limites](https://developers.cloudflare.com/workers/platform/limits/): 64 MiB sem compressão, sem limite comprimido; 1 s de inicialização
- [Drizzle — Transactions](https://orm.drizzle.team/docs/transactions) e [lista de conexões](https://orm.drizzle.team/docs/connect-overview) (não há página de Hyperdrive no Drizzle)
- [Neon — serverless driver](https://neon.com/docs/serverless/serverless-driver) e [Neon com Hyperdrive](https://neon.com/docs/guides/cloudflare-hyperdrive)
- npm: [pg](https://registry.npmjs.org/pg), [postgres](https://registry.npmjs.org/postgres), [downloads de pg, postgres, drizzle-orm](https://api.npmjs.org/downloads/point/last-week/pg,postgres,drizzle-orm), [downloads de @neondatabase/serverless](https://api.npmjs.org/downloads/point/last-week/@neondatabase/serverless); [releases do postgres.js](https://github.com/porsager/postgres/releases)
- Bundlephobia: [pg@8.23.1](https://bundlephobia.com/api/size?package=pg@8.23.1) e [postgres@3.4.9](https://bundlephobia.com/api/size?package=postgres@3.4.9)
- Código instalado no repositório (lido em 21/10/2026): `drizzle-orm@0.45.4` (`node-postgres/session.js`, `postgres-js/session.js`, `errors.js`), `wrangler@4.151.3` (`applyHyperdriveEnvVars`, `validateHyperdriveBinding`), `@cloudflare/vitest-plugin@1.4.6`, `pg@8.23.1` e `pg-cloudflare@1.4.1` (`package.json`)

### Fato, estimativa e o que não foi confirmado

- **Fato verificado** (documentação ou código lido): tudo o que está acima com fonte, inclusive a recomendação do `pg`, o aviso sobre Drizzle + Postgres.js, as limitações e o cache do Hyperdrive, a variável de ambiente e a obrigatoriedade do `id` no wrangler, o `prepare: false` no adaptador postgres-js do Drizzle e o texto de erro do Drizzle.
- **Estimativa minha:** a ligação entre o `prepare: false` do Drizzle e o aviso da Cloudflare (a página não explica o motivo); tamanhos de bundle (o Bundlephobia mede o build de navegador, não o do `workerd`; a diferença de ~12 KB gzip é irrelevante perto do limite de 64 MiB).
- **Não confirmado:** nada foi executado (os limites do papel não permitem instalar nem rodar). Falta confirmar na prática: (1) `wrangler dev` e o plugin do Vitest aceitam um `id` fictício sem login na Cloudflare; (2) `pg` 8.23.1 conecta ao Postgres do Docker de dentro do `workerd` local e dos testes; (3) se leituras dentro de uma transação explícita escapam do cache do Hyperdrive (a documentação não diz).

## Recomendação

**Opção B: `pg` (node-postgres) com `drizzle-orm/node-postgres`, via o binding do Hyperdrive.**

1. É o que a Cloudflare recomenda hoje para Hyperdrive e o único par com Drizzle que ela documenta; o postgres.js com Drizzle tem problema conhecido.
2. Respeita o ADR 0002: passa pelo Hyperdrive, é Postgres padrão e não amarra a provedor. Funciona no local sem conta, direto no Postgres do Docker.
3. Um driver só no repositório (migrações, teste do schema e runtime), o mais conhecido do mercado e com manutenção ativa.

Condições propostas para a implementação:

1. `pg` (>= 8.16.3; hoje 8.23.1) passa a `dependencies` do pacote que abre a conexão. Sugestão: `packages/db` exporta uma função que recebe a string de conexão e devolve o `db` do Drizzle, e `apps/api` só chama essa função. Assim o `pg` fica num lugar só.
2. Um `Client` novo **por invocação**: por requisição no Worker, por execução de Queue ou Cron e por handler no Durable Object (`fetch`, `webSocketMessage`, `alarm`). Nunca no escopo global nem guardado num campo do Durable Object: com um objeto por resenha, conexões presas esgotariam o pool.
3. Binding `HYPERDRIVE` em `apps/api/wrangler.jsonc` com `localConnectionString` para o Postgres do Docker. No CI, a variável `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` recebe o `DATABASE_URL`. O primeiro passo da entrega 2 é um teste mínimo (rota que faz `select 1` pelo binding, rodando no Vitest do Workers) para confirmar os três pontos não confirmados acima; se falhar, parar e avisar.
4. Regras de código desde a entrega 2, porque o local não emula o Hyperdrive: nada de `SET` fora de transação (usar `SET LOCAL` dentro dela); nada de advisory locks (usar `SELECT ... FOR UPDATE` ou restrição `UNIQUE`); nada de `LISTEN`/`NOTIFY` (tempo real é papel do Durable Object); nada de `PREPARE` em SQL; transações curtas e **sem chamadas externas** no meio (enviar o código pelo WhatsApp e validar o Turnstile ficam fora da transação).
5. Dados que precisam estar frescos (tentativas de código do ACE-02, validade de sessão, conta excluída do ACE-06, permissões) não podem vir de um cache de 60 s. No código, preferir checar e atualizar na mesma escrita (por exemplo `UPDATE ... RETURNING`). A configuração do cache em produção (desligar ou ter um segundo binding sem cache) fica para quando a hospedagem e o provedor forem decididos (ADR 0005).
6. Logs: **nunca registrar a mensagem de um erro do Drizzle**, que inclui os parâmetros da consulta (`Failed query: ... params: ...`), nem o campo `detail` de erro do Postgres, que pode trazer valores (por exemplo, o celular numa violação de `UNIQUE`). Registrar só o código SQLSTATE e o nome da restrição. Isso vale para qualquer driver.

A recomendação muda se: a Cloudflare passar a suportar Drizzle + Postgres.js e houver motivo concreto para trocar (hoje não há; o tamanho de bundle não é problema); o teste mínimo do item 3 mostrar que o `pg` não funciona no `workerd` local ou no plugin do Vitest; ou a hospedagem sair do Cloudflare (aí o `pg` continua servindo, já que é o driver padrão em Node).

## Impactos

- Compatibilidade com o runtime do Cloudflare Workers: suportado oficialmente; usa `nodejs_compat`, já ligado por padrão com a `compatibility_date` 2026-10-01; o `pg` traz um módulo de socket próprio para Workers (`pg-cloudflare`, escolhido pela condição de exportação `workerd`).
- Dados pessoais e de menores (onde ficam, quem acessa): o driver só fala com o Postgres; nenhum terceiro novo recebe dados. No local, conexão sem TLS só na máquina (`127.0.0.1`). Risco real é log: ver condição 6.
- Custo mensal estimado no piloto e em escala: zero para o driver (MIT). O custo do Hyperdrive entra na decisão de hospedagem e provedor (ADR 0005).
- Esforço de adoção e de saída (lock-in): adoção pequena (mover `pg` para `dependencies`, um binding no `wrangler.jsonc`, uma função de conexão). Saída barata: o código de consultas é Drizzle; trocar de driver muda a criação do cliente e o import do adaptador. Nenhuma amarra a provedor.
- Conhecimento do time / facilidade de contratar: `pg` é o driver Postgres mais usado em Node (40,1 milhões de downloads semanais); quase todo dev de Node já usou.

## Decisão

Pendente.
