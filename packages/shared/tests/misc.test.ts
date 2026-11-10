import { describe, expect, it } from 'vitest';
import { t } from '../src/i18n';
import { aiClassificationSchema, createUserSchema, loginSchema } from '../src/schemas';
import { formatDuration, slaInfo } from '../src/sla';

describe('i18n', () => {
  it('interpolates and falls back to uz', () => {
    expect(t('ticket.taken', { name: 'Ali' })).toBe('✅ Ali tomonidan olindi');
    expect(t('ticket.taken', { name: 'Ali' }, 'ru')).toBe('✅ Ali tomonidan olindi');
  });
});

describe('schemas', () => {
  it('lowercases usernames and enforces password length', () => {
    expect(loginSchema.parse({ username: 'ALI', password: 'x' }).username).toBe('ali');
    expect(() =>
      createUserSchema.parse({ username: 'ali', displayName: 'Ali', password: 'short' }),
    ).toThrow();
    expect(
      createUserSchema.parse({ username: 'ali', displayName: 'Ali', password: 'longenough1' }).role,
    ).toBe('STAFF');
  });
  it('validates AI classification and fills defaults', () => {
    const r = aiClassificationSchema.parse({ isRequest: true, confidence: 0.9 });
    expect(r).toMatchObject({ systemType: 'OTHER', urgency: 'NORMAL', category: 'other' });
    expect(() => aiClassificationSchema.parse({ isRequest: true, confidence: 2 })).toThrow();
  });
});

describe('SLA', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  it('goes overdue and pauses', () => {
    expect(slaInfo({ status: 'NEW', slaDeadline: '2026-01-01T11:00:00Z' }, now).overdue).toBe(true);
    expect(slaInfo({ status: 'WAITING_CLIENT', slaDeadline: '2026-01-01T11:00:00Z' }, now).overdue).toBe(
      false,
    );
    expect(slaInfo({ status: 'NEW', slaDeadline: new Date('2026-01-01T12:10:00Z') }, now).label).toBe(
      '10:00 qoldi',
    );
    expect(formatDuration(65_000)).toBe('1:05');
  });
});
