import { describe, expect, it } from 'vitest';
import { applyVars, searchTemplates, unresolvedVars } from '../src/logic/templates';
import { formatDuration, slaInfo } from '../src/logic/sla';
import { Bm25Index, tokenize } from '../src/logic/bm25';
import { isCyrillic, mockDraft, searchKb, buildLlmUserPrompt } from '../src/logic/ai';
import { seedMockState } from '../src/logic/seed';
import { computeStats } from '../src/logic/stats';
import { closeWithSolution, currentTicket, findClientForChat, mapChatToClient, takeTicket, assign, createTicket } from '../src/logic/tickets';

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
    const seed = seedMockState(0);
    const r = searchTemplates(seed.templates, 'webhook');
    expect(r[0].id).toBe('t05');
    expect(searchTemplates(seed.templates, '', { category: 'PBX' }).every((t) => t.category === 'PBX')).toBe(true);
    expect(searchTemplates(seed.templates, 'zzzzqqq')).toEqual([]);
  });
  it('treats uzbek apostrophe variants the same', () => {
    const seed = seedMockState(0);
    expect(searchTemplates(seed.templates, 'qoʻngʻiroq').length).toBeGreaterThan(0);
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

describe('BM25 + KB search', () => {
  const kb = seedMockState(0).kb;
  it('tokenizes with apostrophe folding and prefix stemming', () => {
    expect(tokenize("Qo'ng'iroqlar yozilmayapti")).toEqual(['qongi', 'yozil']);
    expect(tokenize('и в на')).toEqual([]);
  });
  it('ranks the obvious article first (uz)', () => {
    expect(searchKb(kb, 'webhook ulanmadi, lidlar tushmayapti')[0].article.id).toBe('kb01');
    expect(searchKb(kb, 'SIP telefon registratsiyadan otmayapti')[0].article.id).toBe('kb09');
  });
  it('works for russian', () => {
    expect(searchKb(kb, 'нет записей звонков')[0].article.id).toBe('kb10');
  });
  it('returns nothing for unrelated text (no invented answer)', () => {
    expect(searchKb(kb, 'bugun ob-havo qanday, futbol kim yutdi')).toEqual([]);
    expect(mockDraft('bugun ob-havo qanday', kb, {}).found).toBe(false);
  });
  it('mock draft uses the client language and KB solution', () => {
    const d = mockDraft('Вебхук не работает, сделки не приходят', kb, { mijoz_nomi: 'Aleksey', xodim: 'Ali' });
    expect(d.found).toBe(true);
    expect(d.sources[0].article.lang).toBe('ru');
    expect(d.draft).toContain('Aleksey');
    expect(d.draft).toContain(d.sources[0].article.solution);
    expect(isCyrillic('привет мир')).toBe(true);
  });
  it('idf is higher for rarer terms', () => {
    const idx = new Bm25Index([{ id: 'a', text: 'webhook webhook' }, { id: 'b', text: 'lid' }, { id: 'c', text: 'lid' }]);
    expect(idx.idf('webho')).toBeGreaterThan(idx.idf('lid'));
  });
  it('LLM prompt contains only provided articles', () => {
    const p = buildLlmUserPrompt('x', [kb[0]], 'Jasur');
    expect(p).toContain('id="kb01"');
    expect(p).not.toContain('kb02');
  });
});

describe('tickets', () => {
  const now = Date.parse('2026-03-01T09:00:00Z');
  it('take = assign + IN_PROGRESS + first response', () => {
    const s0 = seedMockState(now);
    const s = takeTicket(s0, 'T-1042', 'vali', now + 1000);
    const t = s.tickets.find((x) => x.id === 'T-1042')!;
    expect(t.assigneeId).toBe('vali');
    expect(t.status).toBe('IN_PROGRESS');
    expect(t.firstResponseAt).not.toBeNull();
    expect(t.history.map((h) => h.type)).toEqual(['created', 'assign', 'status', 'first_response']);
    expect(t.history.every((h) => h.who === 'vali' || h.who === 'client')).toBe(true);
  });
  it('close with solution stores note and history', () => {
    const s = closeWithSolution(seedMockState(now), 'T-1041', '  https qilindi ', 'ali', now);
    const t = s.tickets.find((x) => x.id === 'T-1041')!;
    expect(t.status).toBe('CLOSED');
    expect(t.solutionNote).toBe('https qilindi');
    expect(t.closedAt).not.toBeNull();
  });
  it('no-op assign does not add history', () => {
    const s0 = seedMockState(now);
    const s = assign(s0, 'T-1041', 'ali', 'ali', now);
    expect(s.tickets.find((x) => x.id === 'T-1041')!.history.length).toBe(s0.tickets.find((x) => x.id === 'T-1041')!.history.length);
  });
  it('maps chats by id first, then by title hint', () => {
    let s = seedMockState(now);
    expect(findClientForChat(s.clients, { chatId: '-100555', title: 'Orient Motors support' })).toMatchObject({ by: 'title', client: { id: 'c1' } });
    s = mapChatToClient(s, 'c2', '-100555');
    expect(findClientForChat(s.clients, { chatId: '-100555', title: 'Orient Motors support' })).toMatchObject({ by: 'id', client: { id: 'c2' } });
    // re-mapping the same chat moves it
    s = mapChatToClient(s, 'c3', '-100555');
    expect(s.clients.filter((c) => c.telegramChatId === '-100555').map((c) => c.id)).toEqual(['c3']);
  });
  it('current ticket prefers newest open one', () => {
    const s = seedMockState(now);
    expect(currentTicket(s.tickets, 'c1')!.id).toBe('T-1041');
    expect(currentTicket(s.tickets, 'c5')!.id).toBe('T-1045'); // only closed
    const { ticket } = createTicket(s, 'c5', 'x', 'ali', now);
    expect(ticket.id).toBe('T-1049');
  });
});

describe('stats', () => {
  it('computes consistent numbers from the seed', () => {
    const now = Date.parse('2026-03-01T15:00:00Z');
    const s = computeStats(seedMockState(now), now);
    expect(s.open).toBe(5);
    expect(s.waiting).toBe(1);
    // T-1044 (180 min, SLA 120) and T-1042 (50 min, SLA 30) are overdue.
    expect(s.overdue).toBe(2);
    expect(s.avgFirstResponseMin).toBeGreaterThan(0);
    expect(s.closedTodayByStaff.find((x) => x.staffId === 'ali')!.count).toBe(1);
  });
});
