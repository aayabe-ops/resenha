# ADR 0003 — Login por código no WhatsApp

- Status: Aceito
- Data: 2026-10-18
- Decisor: Ayabe

## Contexto

O público vive no WhatsApp e o requisito é atrito zero (ACE-01, ACE-02). Senha e e-mail afastam adolescentes. A escolha entre SMS e WhatsApp foi decidida pelo responsável em 18/10/2026.

## Decisão

- Login por número de celular com código de 6 dígitos enviado por template de autenticação do **WhatsApp Cloud API (Meta)**.
- Código guardado só como hash, válido por 10 min; 5 tentativas erradas bloqueiam por 15 min; limite de envios por número e por IP; Turnstile antes do envio.
- Sessão em cookie `httpOnly`, `Secure`, `SameSite=Lax`; no banco, só o hash do token.
- Convidado pode participar de uma resenha sem login (apelido, foto e nascimento), conforme ACE-01.

## Consequências

- Exige conta do WhatsApp Business verificada e template de autenticação aprovado pela Meta antes da entrega 2.
- Custo por mensagem enviada; acompanhar no piloto.
- Sem fallback por SMS no MVP; incluir um exige novo ADR.
