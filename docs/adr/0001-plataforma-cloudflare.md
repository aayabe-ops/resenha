# ADR 0001 — Plataforma de execução: Cloudflare

- Status: Aceito
- Data: 2026-10-18
- Decisor: Ayabe

## Contexto

O uso esperado é em picos curtos (sexta e sábado à noite, todo mundo votando ao mesmo tempo), com tempo real na votação (RNF-02) e entrada pelo link do WhatsApp em menos de 15 s. O time é pequeno e não quer administrar servidores.

## Decisão

Rodar o app no Cloudflare:

- **Workers** para servir o PWA (assets estáticos) e a API (Hono);
- **Durable Objects** com WebSocket para o estado ao vivo, um objeto por resenha;
- **Hyperdrive** para acessar o Postgres (ADR 0002);
- **Queues e Cron Triggers** para tarefas agendadas (apagar endereço em 24 h, expirar códigos);
- **Turnstile** contra robôs no login e na criação de resenha;
- **R2** para arquivos, a partir da fase 2 (uso no MVP em aberto, questão #4).

## Consequências

- Escala e picos sem administrar servidor; custo proporcional ao uso.
- O runtime do Workers não é Node.js completo: toda biblioteca precisa ser checada antes de entrar.
- Durable Objects é uma tecnologia pouco conhecida no mercado; fica restrita ao tempo real e bem documentada.
- O D1 (banco nativo do Cloudflare) foi descartado porque não roda na América do Sul (ADR 0002).
