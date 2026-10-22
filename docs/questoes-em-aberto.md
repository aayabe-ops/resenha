# Questões em aberto

Decisões que ainda não foram tomadas. Ninguém (pessoa ou agente) resolve estas questões por conta própria no código: a decisão é registrada aqui e, se for técnica, vira ADR.

Formato: uma linha por questão, com quem precisa decidir e o que fica bloqueado.

| # | Questão | Quem decide | Bloqueia |
| --- | --- | --- | --- |
| 1 | Nome definitivo do produto e registro de marca | Produto | Nada no MVP (nome configurável) |
| 2 | Regras exatas de consentimento do responsável para 15 a 17 anos (quando é exigido, forma de coleta e de comprovação) | Jurídico | Entrega 2 (ACE-04) |
| 3 | Convidado sem conta que é menor (ACE-01) pode participar antes do consentimento do responsável? | Jurídico + Produto | Entrega 2 e 4 |
| 4 | Onde ficam as fotos de perfil no MVP: antecipar o R2 ou usar avatar por iniciais até a fase 2 | Arquitetura + Produto (ADR) | Entrega 2 (ACE-01, ACE-05) |
| 0 | Hospedagem e deploy (onde o app roda em produção, previews, staging) — adiado: desenvolvimento local primeiro | Ayabe, com o arquiteto | Lançamento do piloto |
| 5 | Provedor do Postgres gerenciado em São Paulo — ADR 0005 adiado (análise pronta, recomenda Neon) | Ayabe, junto com a hospedagem | Lançamento do piloto |
| 6 | Quem compõe a moderação da plataforma e qual o prazo de resposta a denúncias | Produto | Entrega 8 (SEG-04) |
| 7 | Prazo de retenção das denúncias e das decisões de moderação | Jurídico | Entrega 8 |
| 8 | Lista inicial de termos bloqueados (álcool e ofensas) | Produto | Entregas 5, 6 e 8 |
| 9 | Telas visuais e tokens de design adaptados para resenha | Produto / Design | Entrega 4 em diante |
| 10 | Textos de interface (linguagem da galera) | Produto | Entrega 2 em diante (usar `TODO(copy)` até lá) |
| 11 | Ferramenta de erros — ADR 0006 adiado (análise pronta, recomenda o nativo do Cloudflare) | Ayabe, junto com a hospedagem | Lançamento do piloto |
| 12 | Driver do Postgres usado pelo Worker e pelos Durable Objects em tempo de execução (via Hyperdrive). Na entrega 1, `pg` entrou só como dependência de desenvolvimento para as migrações — ADR 0007 proposto (recomenda `pg` com `drizzle-orm/node-postgres`), aguardando decisão | Ayabe (ADR 0007) | Entrega 2 (primeira rota que acessa o banco) |
