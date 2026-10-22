import { describe, expect, it } from 'vitest';
import { ageOn, isMinor, isUnderMinAge, neutralBirthDate, todayIso } from '../src/age';
import { birthDateSchema, phoneSchema } from '../src/validation';

describe('idade', () => {
  it('conta o aniversário só a partir do dia', () => {
    expect(ageOn('2011-10-21', '2026-10-20')).toBe(14);
    expect(ageOn('2011-10-21', '2026-10-21')).toBe(15);
  });

  it('bloqueia abaixo de 15 e marca menor até 18 (ACE-03, ACE-04)', () => {
    expect(isUnderMinAge('2011-10-22', '2026-10-21')).toBe(true);
    expect(isUnderMinAge('2011-10-21', '2026-10-21')).toBe(false);
    expect(isMinor('2008-10-22', '2026-10-21')).toBe(true);
    expect(isMinor('2008-10-21', '2026-10-21')).toBe(false);
  });

  it('usa a data de São Paulo', () => {
    // 02:00 UTC de 22/10 ainda é 21/10 em São Paulo
    expect(todayIso(new Date('2026-10-22T02:00:00Z'))).toBe('2026-10-21');
  });
});

describe('data neutra da exclusão de conta (ACE-06)', () => {
  it('menor fica menor até pelo menos o aniversário real de 18', () => {
    const neutral = neutralBirthDate('2010-03-15', '2026-10-21');
    expect(neutral).toBe('2010-12-31');
    // No dia em que faria 18 de verdade, a data neutra ainda é de menor
    expect(isMinor(neutral, '2028-03-15')).toBe(true);
    expect(isMinor(neutral, '2028-12-31')).toBe(false);
  });

  it('maior vira 01/01/1900', () => {
    expect(neutralBirthDate('1999-05-01', '2026-10-21')).toBe('1900-01-01');
  });
});

describe('validação', () => {
  it('aceita só celular E.164', () => {
    expect(phoneSchema.safeParse('+5511999998888').success).toBe(true);
    expect(phoneSchema.safeParse('11999998888').success).toBe(false);
  });

  it('recusa nascimento no futuro ou inválido', () => {
    expect(birthDateSchema.safeParse('2008-02-30').success).toBe(false);
    expect(birthDateSchema.safeParse('2999-01-01').success).toBe(false);
    expect(birthDateSchema.safeParse('2008-02-28').success).toBe(true);
  });
});
