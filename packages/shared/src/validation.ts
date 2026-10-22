import { z } from 'zod';
import { todayIso } from './age';

// Celular em formato internacional E.164, igual à restrição de users.phone_e164
export const phoneSchema = z.string().regex(/^\+[1-9][0-9]{7,14}$/);

export const birthDateSchema = z.iso
  .date()
  .refine((value) => value <= todayIso() && value >= '1900-01-01');

// Mesmos limites de users.nickname (1 a 30 caracteres)
export const nicknameSchema = z.string().trim().min(1).max(30);

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
