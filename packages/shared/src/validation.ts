import { z } from 'zod';
import { todayIso } from './age';

// Celular em formato internacional E.164, igual à restrição de users.phone_e164
export const phoneSchema = z.string().regex(/^\+[1-9][0-9]{7,14}$/);

export const birthDateSchema = z.iso
  .date()
  .refine((value) => value <= todayIso() && value >= '1900-01-01');

// Mesmos limites de users.nickname (1 a 30 caracteres)
export const nicknameSchema = z.string().trim().min(1).max(30);

// Mesmos limites de groups.name (1 a 40 caracteres)
export const groupNameSchema = z.string().trim().min(1).max(40);

export const createGroupBody = z.object({ name: groupNameSchema });

// Mesmos limites de resenhas.name (1 a 60 caracteres, opcional)
export const resenhaNameSchema = z.string().trim().min(1).max(60);

export const pollKindSchema = z.enum(['where', 'when', 'split']);

// RES-01: nome opcional, dia e quais votações abrir. Turnstile na criação
// de resenha (spec, seção 1).
export const createResenhaBody = z.object({
  name: resenhaNameSchema.nullish(),
  date: z.iso.date().refine((value) => value >= todayIso()),
  polls: z.array(pollKindSchema).max(3),
  turnstileToken: z.string().min(1),
});

export const rsvpBody = z.object({ rsvp: z.enum(['going', 'maybe', 'not_going']) });

export const joinResenhaBody = z.object({ from: z.uuid().nullish() });

// Opção de votação: mesmos limites de poll_options.label (1 a 60)
export const optionBody = z.object({ label: z.string().trim().min(1).max(60) });

// Opção de horário: hora no dia da resenha (HH:MM)
export const timeLabelSchema = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);

// DIV-04: quem oferece a casa informa só o bairro ("Uma casa em <bairro>" cabe em 60)
export const offerHomeBody = z.object({ neighborhood: z.string().trim().min(1).max(48) });

// LOC-02: endereço exato, informado pelo anfitrião
export const addressBody = z.object({ address: z.string().trim().min(1).max(200) });

// DIV-01: mesmos limites de items.description
export const itemBody = z.object({ description: z.string().trim().min(1).max(60) });

// DIV-02: valor total em centavos (até R$ 100 mil)
export const totalCostBody = z.object({
  totalCostCents: z.number().int().min(0).max(10_000_000).nullable(),
});

export const voteBody = z.object({ optionId: z.uuid() });

export const closePollBody = z.object({ optionId: z.uuid().nullish() });

export const deadlineBody = z.object({ closesAt: z.iso.datetime({ offset: true }).nullable() });

export const suggestionsBody = z.object({ allow: z.boolean() });

export const loginCodeSchema = z.string().regex(/^[0-9]{6}$/);

export const requestCodeBody = z.object({
  phone: phoneSchema,
  birthDate: birthDateSchema,
  turnstileToken: z.string().min(1),
});

export const verifyCodeBody = z.object({
  phone: phoneSchema,
  code: loginCodeSchema,
});

export const registerBody = z.object({
  registrationToken: z.string().min(1),
  nickname: nicknameSchema,
  birthDate: birthDateSchema,
});

export const guestBody = z.object({
  nickname: nicknameSchema,
  birthDate: birthDateSchema,
});

export type RequestCodeBody = z.infer<typeof requestCodeBody>;
export type VerifyCodeBody = z.infer<typeof verifyCodeBody>;
export type RegisterBody = z.infer<typeof registerBody>;
export type GuestBody = z.infer<typeof guestBody>;
export type CreateGroupBody = z.infer<typeof createGroupBody>;
export type CreateResenhaBody = z.infer<typeof createResenhaBody>;
