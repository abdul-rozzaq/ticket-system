import { isWithinWorkingHours, pickAssignee, suggestAssignee, type Candidate } from './assignment';
import { hasUrgentKeyword, parseCommand, prefilter } from './intake-rules';
import { folderKeyForTicket, planFolderSync, type CurrentFolder, type DesiredFolder } from './folders';

const cand = (id: string, o: Partial<Candidate> = {}): Candidate => ({
  id, isActive: true, available: true, onDuty: false, openCount: 0, lastAssignedAt: null, ...o,
});

describe('assignment strategies', () => {
  const team = [cand('ali', { openCount: 3 }), cand('vali', { openCount: 1 }), cand('sardor', { openCount: 1, lastAssignedAt: new Date('2026-01-01') })];

  it('MANUAL never auto-assigns', () => expect(pickAssignee('MANUAL', team)).toBeNull());

  it('LEAST_LOADED picks the lowest count, ties broken by least recently assigned', () => {
    expect(pickAssignee('LEAST_LOADED', team)).toBe('vali');
  });

  it('LEAST_LOADED skips busy and inactive people', () => {
    expect(pickAssignee('LEAST_LOADED', [cand('a', { available: false }), cand('b', { isActive: false }), cand('c', { openCount: 9 })])).toBe('c');
    expect(pickAssignee('LEAST_LOADED', [cand('a', { available: false })])).toBeNull();
  });

  it('ROUND_ROBIN rotates by last assignment time (never-assigned first)', () => {
    const t = [cand('a', { lastAssignedAt: new Date('2026-01-03') }), cand('b', { lastAssignedAt: new Date('2026-01-01') }), cand('c')];
    expect(pickAssignee('ROUND_ROBIN', t)).toBe('c');
    expect(pickAssignee('ROUND_ROBIN', t.filter((x) => x.id !== 'c'))).toBe('b');
  });

  it('FIXED_OWNER gives it to the owner even when busy, but not when inactive', () => {
    expect(pickAssignee('FIXED_OWNER', [cand('o', { available: false })], { fixedOwnerId: 'o' })).toBe('o');
    expect(pickAssignee('FIXED_OWNER', [cand('o', { isActive: false })], { fixedOwnerId: 'o' })).toBeNull();
    expect(pickAssignee('FIXED_OWNER', team, {})).toBeNull();
  });

  it('ON_DUTY needs the duty flag and working hours (Tashkent time)', () => {
    const wh = { tz: 'Asia/Tashkent', days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00' };
    const monday10 = new Date('2026-03-02T05:00:00Z'); // 10:00 Tashkent (UTC+5)
    const monday20 = new Date('2026-03-02T15:00:00Z'); // 20:00
    const sunday10 = new Date('2026-03-01T05:00:00Z');
    const t = [cand('a', { onDuty: true, workingHours: wh, openCount: 2 }), cand('b', { onDuty: true, workingHours: wh, openCount: 1 }), cand('c', { workingHours: wh })];
    expect(pickAssignee('ON_DUTY', t, { now: monday10 })).toBe('b');
    expect(pickAssignee('ON_DUTY', t, { now: monday20 })).toBeNull();
    expect(pickAssignee('ON_DUTY', t, { now: sunday10 })).toBeNull();
  });

  it('working hours: no schedule means always on', () => expect(isWithinWorkingHours(null)).toBe(true));

  it('suggestion prefers the previous handler, else least loaded', () => {
    expect(suggestAssignee(team, { lastHandlerId: 'ali' })).toBe('ali');
    expect(suggestAssignee(team, { lastHandlerId: 'gone' })).toBe('vali');
    expect(suggestAssignee([cand('ali', { available: false })], { lastHandlerId: 'ali' })).toBeNull();
  });
});

describe('intake prefilter', () => {
  const f = (s: string | null, extra: object = {}) => prefilter(s, { minChars: 6, ...extra });

  it.each([
    ['👍', 'EMOJI_ONLY'], ['🙏 🙏', 'EMOJI_ONLY'], ['', 'EMPTY'], [null, 'EMPTY'],
    ['Rahmat!', 'ACKNOWLEDGEMENT'], ["Xo'p", 'ACKNOWLEDGEMENT'], ['Xoʻp', 'ACKNOWLEDGEMENT'], ['Спасибо)', 'ACKNOWLEDGEMENT'],
    ['ok 👍', 'ACKNOWLEDGEMENT'], ['Thank you', 'ACKNOWLEDGEMENT'], ['salom', 'ACKNOWLEDGEMENT'],
    ['bor', 'TOO_SHORT'], ['??', 'TOO_SHORT'],
  ])('%j -> %s', (text, reason) => expect(f(text as string | null)).toBe(reason));

  it.each([['Webhook ulanmadi, lidlar tushmayapti'], ['Не работает телефония, срочно'], ['AmoCRMda login qilib bo\'lmayapti']])(
    'lets real requests through: %s',
    (text) => expect(f(text)).toBeNull(),
  );

  it('skips our own staff and honours custom stop words', () => {
    expect(f('Tekshiryapmiz, biroz kuting', { fromStaff: true })).toBe('STAFF_MESSAGE');
    expect(f('tushundim rahmat', { extraStopWords: ['tushundim rahmat'] })).toBe('ACKNOWLEDGEMENT');
  });
});

describe('command parser', () => {
  it.each([
    ['.done', { name: 'done', arg: '' }],
    ['#done token yangilandi', { name: 'done', arg: 'token yangilandi' }],
    ['.DONE   ok', { name: 'done', arg: 'ok' }],
    ['.wait', { name: 'wait', arg: '' }],
    ['.note mijoz qayta qo\'ng\'iroq qiladi\nikkinchi qator', { name: 'note', arg: "mijoz qayta qo'ng'iroq qiladi\nikkinchi qator" }],
    ['.ai', { name: 'ai', arg: '' }],
  ])('%j', (text, expected) => expect(parseCommand(text)).toEqual(expected));

  it.each([['done'], ['men .done qildim'], ['.donee'], ['..done'], [''], [null]])('%j is not a command', (t) =>
    expect(parseCommand(t as string | null)).toBeNull(),
  );

  it('detects urgent keywords in uz/ru', () => {
    expect(hasUrgentKeyword("Hamma narsa to'xtab qoldi!")).toBe(true);
    expect(hasUrgentKeyword('Срочно нужна помощь')).toBe(true);
    expect(hasUrgentKeyword('Savol bor edi')).toBe(false);
  });
});

describe('folder reconciliation', () => {
  const limits = { maxFolders: 10, maxChatsPerFolder: 100, foreignFolderCount: 2 };
  const D = (key: string, chatKeys: string[], kind: 'SYSTEM' | 'STAFF' = 'SYSTEM', title = key): DesiredFolder => ({ key, title, chatKeys, kind });
  const C = (key: string, id: number, chatKeys: string[], title = key): CurrentFolder => ({ key, telegramFilterId: id, title, chatKeys });

  it('creates missing folders, updates changed ones, deletes obsolete ones, leaves identical ones alone', () => {
    const plan = planFolderSync(
      [D('NEW', ['c:1', 'c:2']), D('WAITING', ['c:3']), D('USER:ali', ['c:4'], 'STAFF', '👤 Ali')],
      [C('NEW', 11, ['c:2', 'c:1']), C('WAITING', 12, ['c:9']), C('USER:gone', 13, ['c:5'], '👤 Gone')],
      limits,
    );
    expect(plan.ops.map((o) => `${o.op}:${o.key}`)).toEqual(['delete:USER:gone', 'update:WAITING', 'create:USER:ali']);
    expect(plan.degraded).toBe(false);
  });

  it('is idempotent: applying the plan and planning again yields nothing', () => {
    const desired = [D('NEW', ['c:1']), D('USER:ali', ['c:2'], 'STAFF')];
    const plan = planFolderSync(desired, [], limits);
    const applied = plan.ops.filter((o) => o.op === 'create').map((o, i) => C(o.key, 100 + i, (o as { chatKeys: string[] }).chatKeys));
    expect(planFolderSync(desired, applied.map((a) => ({ ...a, title: a.key })), limits).ops).toEqual([]);
  });

  it('degrades to system folders when staff folders would exceed the account limit', () => {
    const desired = [D('NEW', []), D('WAITING', []), D('OVERDUE', []), ...['a', 'b', 'c', 'd', 'e', 'f'].map((u) => D(`USER:${u}`, [], 'STAFF'))];
    const plan = planFolderSync(desired, [], { ...limits, maxFolders: 10, foreignFolderCount: 5 }); // budget 5 < 9 needed
    expect(plan.degraded).toBe(true);
    expect(plan.ops.map((o) => o.key)).toEqual(['NEW', 'WAITING', 'OVERDUE']);
    expect(plan.warnings[0]).toContain('Premium');
  });

  it('removes our existing staff folders when degrading (frees quota) but never touches foreign ones', () => {
    const plan = planFolderSync([D('NEW', [])], [C('NEW', 1, []), C('USER:a', 2, [])], limits);
    expect(plan.ops).toEqual([{ op: 'delete', key: 'USER:a', telegramFilterId: 2 }]);
  });

  it('truncates over-full folders and warns near the limit', () => {
    const many = Array.from({ length: 120 }, (_, i) => `c:${i}`);
    const plan = planFolderSync([D('NEW', many), D('WAITING', many.slice(0, 95))], [], limits);
    expect((plan.ops[0] as { chatKeys: string[] }).chatKeys).toHaveLength(100);
    expect(plan.warnings.some((w) => w.includes('kesildi'))).toBe(true);
    expect(plan.warnings.some((w) => w.includes("to'lib qolmoqda"))).toBe(true);
  });

  it('maps tickets to exactly one folder', () => {
    expect(folderKeyForTicket({ status: 'NEW', assigneeId: null, overdue: false })).toBe('NEW');
    expect(folderKeyForTicket({ status: 'IN_PROGRESS', assigneeId: 'u1', overdue: false })).toBe('USER:u1');
    expect(folderKeyForTicket({ status: 'IN_PROGRESS', assigneeId: 'u1', overdue: true })).toBe('OVERDUE');
    expect(folderKeyForTicket({ status: 'WAITING_CLIENT', assigneeId: 'u1', overdue: false })).toBe('WAITING');
    expect(folderKeyForTicket({ status: 'CLOSED', assigneeId: 'u1', overdue: false })).toBeNull();
  });
});
