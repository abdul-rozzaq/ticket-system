import { describe, expect, it } from 'vitest';
import { applyVars, searchTemplates, unresolvedVars } from '../src/logic/templates';
import { formatDuration, slaInfo } from '../src/logic/sla';

const tpl = (id: string, title: string, category: string, body: string, keywords: string[] = []) => ({ id, title, category, body, keywords });
const TEMPLATES = [
  tpl('a', 'Webhook tekshirish', 'AmoCRM', 'Manzilni tekshiring', ['webhook']),
  tpl('b', "Qo'ng'iroq ketmayapti", 'PBX', 'SIP akkauntni tekshiring', ['qongiroq']),
  tpl('c', 'Salomlashuv', 'salomlashuv', 'Webhook haqida savol bo‘lsa yozing'),
];

describe('template variables', () => {
  it('substitutes known vars and keeps unknown/empty ones visible', () => {
    const out = applyVars('Salom {mijoz_nomi}, {tizim} — {xodim}. {boshqa}', { mijoz_nomi: 'Jasur', tizim: 'AmoCRM', xodim: '' });
    expect(out).toBe('Salom Jasur, AmoCRM — {xodim}. {boshqa}');
    expect(unresolvedVars(out)).toEqual(['xodim', 'boshqa']);
  });
  it('is case-insensitive on var names', () => {
    expect(applyVars('{Mijoz_Nomi}', { mijoz_nomi: 'X' })).toBe('X');
  });
  it('ranks title prefix above body match and honours category', () => {
    expect(searchTemplates(TEMPLATES, 'webhook').map((t) => t.id)).toEqual(['a', 'c']);
    expect(searchTemplates(TEMPLATES, '', { category: 'PBX' }).every((t) => t.category === 'PBX')).toBe(true);
    expect(searchTemplates(TEMPLATES, 'zzzzqqq')).toEqual([]);
  });
  it('treats uzbek apostrophe variants the same', () => {
    expect(searchTemplates(TEMPLATES, 'qoʻngʻiroq').length).toBeGreaterThan(0);
  });
  it('usage breaks ties', () => {
    const same = [tpl('x', 'Test one', 'c', 'b'), tpl('y', 'Test two', 'c', 'b')];
    expect(searchTemplates(same, 'test', { usage: { y: 3 } })[0].id).toBe('y');
  });
});

describe('SLA math', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  it('counts down and goes overdue', () => {
    expect(slaInfo({ status: 'NEW', slaDeadline: '2026-01-01T12:10:00Z' }, now)).toMatchObject({ overdue: false, remainingMs: 600_000, label: '10:00 qoldi' });
    const o = slaInfo({ status: 'IN_PROGRESS', slaDeadline: '2026-01-01T11:00:00Z' }, now);
    expect(o.overdue).toBe(true);
    expect(o.label).toBe("muddati o'tdi 1:00:00");
  });
  it('pauses for waiting and closed tickets', () => {
    expect(slaInfo({ status: 'WAITING_CLIENT', slaDeadline: '2026-01-01T11:00:00Z' }, now)).toMatchObject({ overdue: false, paused: true });
    expect(slaInfo({ status: 'CLOSED', slaDeadline: '2026-01-01T11:00:00Z' }, now).overdue).toBe(false);
  });
  it('formats durations', () => {
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
    expect(formatDuration(-90_000)).toBe('-1:30');
    expect(formatDuration(90_000_000)).toBe('1k 1s');
  });
});
