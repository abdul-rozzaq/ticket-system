// Integration test: the REAL API + the REAL UserbotWorker (apps/userbot) + an in-memory fake Telegram, talking over real HTTP.
// What it proves: the API <-> userbot contract (LIST_FOLDERS / APPLY_FOLDERS), the reconcile logic, idempotence,
// quota handling and "never touch foreign folders". What it cannot prove: how real Telegram behaves.
import { adminToken, bearer, createTestApp, SERVICE_TOKEN, TestCtx } from './helpers';
import { FoldersService } from '../src/apps/funnel/folders.service';
import { TicketsService } from '../src/apps/tickets/tickets.service';
import { ApiClient } from '../../userbot/src/api-client';
import { FakeTelegramClient } from '../../userbot/src/fake-client';
import { UserbotWorker } from '../../userbot/src/worker';

const SESSION = 'FAKE-SESSION-0123456789ABCDEFGH';
const quiet = { info() {}, warn() {}, error() {} };

describe('Telegram folder sync (API + real userbot worker + fake Telegram)', () => {
  let ctx: TestCtx;
  let admin: string;
  let tg: FakeTelegramClient;
  let worker: UserbotWorker;
  let staff: Array<{ id: string; name: string }>;
  const groups: Array<{ id: string; key: string; company: string }> = [];
  const tickets = () => ctx.app.get(TicketsService);
  const folders = () => ctx.app.get(FoldersService);

  /** Lets the userbot answer API commands while an API request is in flight. */
  async function pump<T>(p: Promise<T>): Promise<T> {
    let done = false;
    const wrapped = p.finally(() => {
      done = true;
    });
    wrapped.catch(() => undefined);
    while (!done) {
      await worker.pollOnce(0);
      await new Promise((r) => setTimeout(r, 25));
    }
    return wrapped;
  }
  const sync = () =>
    pump(
      ctx
        .http()
        .post('/api/v1/telegram/folders/sync')
        .set(bearer(admin))
        .then((r) => r.body),
    );
  const preview = () =>
    pump(
      ctx
        .http()
        .get('/api/v1/telegram/folders/preview')
        .set(bearer(admin))
        .then((r) => r.body),
    );
  const ours = () => tg.folders.filter((f) => /^(🆕|⏳|🔴|👤)/.test(f.title));
  const byTitle = (title: string) => tg.folders.find((f) => f.title === title);
  const open = async (i: number, urgency: 'LOW' | 'NORMAL' | 'HIGH' = 'NORMAL') =>
    (await tickets().createTicket({ clientGroupId: groups[i].id, text: `muammo ${i}`, urgency })).ticket;
  const settings = (s: object) => ctx.http().put('/api/v1/settings').set(bearer(admin)).send(s);

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.app.listen(0);
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await ctx.reset();
    admin = await adminToken(ctx);
    staff = [];
    for (const n of ['ali', 'vali']) {
      const u = await ctx
        .http()
        .post('/api/v1/users')
        .set(bearer(admin))
        .send({ username: n, displayName: n[0].toUpperCase() + n.slice(1), password: 'Temp-password-1' });
      staff.push({ id: u.body.id, name: u.body.displayName });
    }
    groups.length = 0;
    for (let i = 1; i <= 4; i++) {
      const g = await ctx
        .http()
        .post('/api/v1/client-groups')
        .set(bearer(admin))
        .send({ telegramChatId: `-100${i}00000000${i}`, title: `G${i}`, companyName: `Company ${i}` });
      groups.push({ id: g.body.id, key: g.body.telegramChatId, company: `Company ${i}` });
    }
    // fake Telegram that can see all four groups, logged in with a stored session, wired to the API over real HTTP
    tg = new FakeTelegramClient();
    tg.validSession = SESSION;
    tg.dialogs = groups.map((g) => ({ chatId: g.key, title: g.company }));
    await ctx.http().put('/api/v1/internal/userbot/session').set(ctx.svc()).send({ session: SESSION });
    const port = (ctx.app.getHttpServer().address() as { port: number }).port;
    worker = new UserbotWorker({
      client: tg,
      api: new ApiClient({
        baseUrl: `http://127.0.0.1:${port}`,
        serviceToken: SERVICE_TOKEN,
        logger: quiet,
        sleep: async () => undefined,
      }),
      logger: quiet,
      sleep: async () => undefined,
      telegramGapMs: 0,
    });
    await worker.connect();
  });

  async function seed() {
    const t1 = await open(0); // unassigned          -> NEW
    const t2 = await open(1);
    await tickets().take(t2.id, staff[0].id); //        -> USER:ali
    const t3 = await open(2);
    await tickets().take(t3.id, staff[1].id);
    await tickets().setStatus(t3.id, 'WAITING_CLIENT', staff[1].id); // -> WAITING
    return { t1, t2, t3 };
  }

  it('dry run shows the plan and changes NOTHING (no Telegram writes, no state, no log)', async () => {
    await seed();
    const r = await preview();
    expect(r).toMatchObject({ status: 'OK', dryRun: true });
    expect(r.plan.ops.map((o: { op: string; key: string }) => `${o.op}:${o.key}`)).toEqual(
      expect.arrayContaining([
        'create:NEW',
        'create:WAITING',
        'create:OVERDUE',
        `create:USER:${staff[0].id}`,
        `create:USER:${staff[1].id}`,
      ]),
    );
    expect(r.limits).toMatchObject({ maxFolders: 10, maxChatsPerFolder: 100, foreignFolders: 0 });
    expect(tg.called('applyFolderOp')).toHaveLength(0);
    expect(tg.folders).toHaveLength(0);
    expect(await ctx.prisma.telegramFolderState.count()).toBe(0);
    expect(await ctx.prisma.folderOperation.count()).toBe(0);
  });

  it('sync creates the funnel folders with exactly one folder per chat, records state, log and last run', async () => {
    const { t1, t2, t3 } = await seed();
    const r = await sync();
    expect(r).toMatchObject({ status: 'OK' });
    expect(byTitle('🆕 Yangi')!.chatKeys).toEqual([groups[0].key]);
    expect(byTitle('👤 Ali')!.chatKeys).toEqual([groups[1].key]);
    expect(byTitle('⏳ Kutilmoqda')!.chatKeys).toEqual([groups[2].key]);
    // Telegram refuses empty folders: empty funnel folders hold the Saved Messages placeholder
    expect(byTitle('🔴 Kechikkan')!.chatKeys).toEqual(['self']);
    expect(byTitle('👤 Vali')!.chatKeys).toEqual(['self']);
    expect(ours()).toHaveLength(5);
    // invariant: no chat is in more than one funnel folder
    for (const g of groups)
      expect(ours().filter((f) => f.chatKeys.includes(g.key)).length).toBeLessThanOrEqual(1);
    expect(groups[3].key).not.toBe(undefined);
    expect(ours().some((f) => f.chatKeys.includes(groups[3].key))).toBe(false); // no ticket -> in no folder

    const rows = await ctx.prisma.telegramFolderState.findMany();
    expect(rows).toHaveLength(5);
    expect(rows.find((x) => x.key === 'NEW')).toMatchObject({
      telegramFilterId: byTitle('🆕 Yangi')!.id,
      chatCount: 1,
    });
    const log = await ctx.prisma.folderOperation.findMany();
    expect(log.filter((l) => l.op === 'create' && l.ok)).toHaveLength(5);
    const status = (await ctx.http().get('/api/v1/telegram/folders').set(bearer(admin))).body;
    expect(status.lastRun).toMatchObject({
      status: 'OK',
      trigger: 'manual',
      ops: { create: 5, update: 0, delete: 0 },
    });
    void t1;
    void t2;
    void t3;
  });

  it('is IDEMPOTENT: a second sync does nothing (no Telegram writes)', async () => {
    await seed();
    await sync();
    const writes = tg.called('applyFolderOp').length;
    const second = await sync();
    expect(second.status).toBe('OK');
    expect(second.plan.ops).toEqual([]);
    expect(tg.called('applyFolderOp')).toHaveLength(writes);
  });

  it('follows ticket changes: assigning, closing and SLA breach move chats between folders', async () => {
    const { t1, t2 } = await seed();
    await sync();

    await tickets().assign(t1.id, staff[1].id, null); // Yangi -> Vali
    await sync();
    expect(byTitle('🆕 Yangi')!.chatKeys).toEqual(['self']);
    expect(byTitle('👤 Vali')!.chatKeys).toEqual([groups[0].key]);

    await tickets().close(t2.id, staff[0].id, 'tayyor'); // closed: removed from ALL funnel folders
    await sync();
    expect(ours().some((f) => f.chatKeys.includes(groups[1].key))).toBe(false);
    expect(byTitle('👤 Ali')!.chatKeys).toEqual(['self']);

    await ctx.prisma.ticket.update({
      where: { id: t1.id },
      data: { slaDeadline: new Date(Date.now() - 60_000) },
    }); // Kechikkan wins
    await sync();
    expect(byTitle('🔴 Kechikkan')!.chatKeys).toEqual([groups[0].key]);
    expect(byTitle('👤 Vali')!.chatKeys).toEqual(['self']);
  });

  it('within a folder urgent chats come first', async () => {
    await open(0, 'LOW');
    await open(1, 'HIGH');
    await open(2, 'NORMAL');
    await sync();
    expect(byTitle('🆕 Yangi')!.chatKeys).toEqual([groups[1].key, groups[2].key, groups[0].key]);
  });

  it('NEVER touches folders the system did not create; they only count against the quota', async () => {
    await seed();
    const work = tg.addForeignFolder('Ish', [groups[0].key, groups[1].key]);
    const personal = tg.addForeignFolder('Shaxsiy', ['self']);
    const before = JSON.stringify([work, personal]);
    const r = await sync();
    expect(r.limits.foreignFolders).toBe(2);
    await sync();
    const t = (await tickets().createTicket({ clientGroupId: groups[3].id, text: 'yana' })).ticket;
    await tickets().close(t.id, null);
    await ctx.http().patch(`/api/v1/users/${staff[0].id}`).set(bearer(admin)).send({ isActive: false });
    await new Promise((x) => setTimeout(x, 300));
    await sync();
    expect(
      JSON.stringify([
        tg.folders.find((f) => f.id === work.id),
        tg.folders.find((f) => f.id === personal.id),
      ]),
    ).toBe(before);
    expect(
      tg
        .called('applyFolderOp')
        .every((c) => (c.args[0] as { telegramFilterId?: number }).telegramFilterId !== work.id),
    ).toBe(true);
  });

  it('QUOTA: too many foreign folders -> only system folders (staff folders skipped) with a Premium warning', async () => {
    await seed();
    for (let i = 0; i < 6; i++) tg.addForeignFolder(`F${i}`); // 10 - 6 = 4 free slots, 5 wanted
    const r = await sync();
    expect(r.status).toBe('OK');
    expect(r.plan.degraded).toBe(true);
    expect(r.warnings.some((w: string) => w.includes('Premium'))).toBe(true);
    expect(
      ours()
        .map((f) => f.title)
        .sort(),
    ).toEqual(['⏳ Kutilmoqda', '🆕 Yangi', '🔴 Kechikkan']);
    expect(tg.folders).toHaveLength(9);
    // chats that would have been in staff folders now sit in the system folders' own stages only (Ali's ticket has no system folder)
    expect(ours().some((f) => f.chatKeys.includes(groups[1].key))).toBe(false);
  });

  it('QUOTA: when even the system folders do not fit, only the first ones are created, and Premium lifts the limit', async () => {
    await seed();
    for (let i = 0; i < 8; i++) tg.addForeignFolder(`F${i}`);
    const r = await sync();
    expect(r.warnings.some((w: string) => w.includes('limiti'))).toBe(true);
    expect(tg.folders).toHaveLength(10);
    tg.premium = true; // limits 20 / 200
    const again = await sync();
    expect(again.limits).toMatchObject({ maxFolders: 20, premium: true });
    expect(ours()).toHaveLength(5);
  });

  it('a folder deleted by hand in Telegram is re-created; renamed / tampered folders are repaired', async () => {
    await seed();
    await sync();
    const ali = byTitle('👤 Ali')!;
    tg.folders.splice(tg.folders.indexOf(ali), 1); // person deletes it
    const yangi = byTitle('🆕 Yangi')!;
    yangi.title = 'Mening papkam'; // renamed
    yangi.chatKeys.push(groups[3].key); // and somebody added a chat by hand
    const r = await sync();
    expect(r.status).toBe('OK');
    expect(byTitle('👤 Ali')!.chatKeys).toEqual([groups[1].key]);
    expect(byTitle('🆕 Yangi')!.chatKeys).toEqual([groups[0].key]);
    expect(await ctx.prisma.telegramFolderState.count({ where: { key: `USER:${staff[0].id}` } })).toBe(1);
  });

  it('deactivating a person: their tickets return to Yangi, their folder is deleted', async () => {
    await seed();
    await sync();
    await ctx.http().patch(`/api/v1/users/${staff[0].id}`).set(bearer(admin)).send({ isActive: false });
    await new Promise((x) => setTimeout(x, 300));
    await sync();
    expect(byTitle('👤 Ali')).toBeUndefined();
    expect(byTitle('🆕 Yangi')!.chatKeys).toEqual(expect.arrayContaining([groups[0].key, groups[1].key]));
    expect(await ctx.prisma.telegramFolderState.count({ where: { key: `USER:${staff[0].id}` } })).toBe(0);
    expect((await ctx.prisma.folderOperation.findMany({ where: { op: 'delete' } })).length).toBe(1);
  });

  it('a new person gets a folder on the next sync', async () => {
    await seed();
    await sync();
    await ctx
      .http()
      .post('/api/v1/users')
      .set(bearer(admin))
      .send({ username: 'sardor', displayName: 'Sardor', password: 'Temp-password-1' });
    await sync();
    expect(byTitle('👤 Sardor')).toBeDefined();
  });

  it('long staff names are shortened to the 12-character folder limit', async () => {
    await ctx
      .http()
      .post('/api/v1/users')
      .set(bearer(admin))
      .send({ username: 'muhammad', displayName: 'Muhammadyusuf', password: 'Temp-password-1' });
    await sync();
    expect(tg.folders.every((f) => f.title.length <= 12)).toBe(true);
    expect(byTitle('👤 Muhammady')).toBeDefined();
  });

  it('settings: staff folders off, empty folders removed instead of placeholders', async () => {
    await seed();
    await settings({ 'funnel.staffFolders': false, 'funnel.emptyFolders': 'remove' });
    await sync();
    expect(
      ours()
        .map((f) => f.title)
        .sort(),
    ).toEqual(['⏳ Kutilmoqda', '🆕 Yangi']); // no staff folders, no empty "Kechikkan"
    // the first overdue chat brings the folder to life, closing the last one removes it again
    const t = (await tickets().createTicket({ clientGroupId: groups[3].id, text: 'tez' })).ticket;
    await ctx.prisma.ticket.update({
      where: { id: t.id },
      data: { slaDeadline: new Date(Date.now() - 1000) },
    });
    await sync();
    expect(byTitle('🔴 Kechikkan')!.chatKeys).toEqual([groups[3].key]);
    await tickets().close(t.id, null);
    await sync();
    expect(byTitle('🔴 Kechikkan')).toBeUndefined();
  });

  it('folders can be disabled entirely; an offline userbot is reported and nothing is queued', async () => {
    await seed();
    await settings({ 'funnel.foldersEnabled': false });
    expect((await sync()).status).toBe('DISABLED');
    await settings({ 'funnel.foldersEnabled': true });
    await ctx.prisma.userbotSession.updateMany({
      data: { lastActivityAt: new Date(Date.now() - 10 * 60_000) },
    });
    const before = await ctx.prisma.userbotCommand.count();
    const r = await sync();
    expect(r.status).toBe('USERBOT_OFFLINE');
    expect(await ctx.prisma.userbotCommand.count()).toBe(before);
  });

  it('chats the TP account cannot see are left out with a warning; WebK (ambiguous) ids are resolved', async () => {
    // group 4 is created from a WebK-style id (no -100 prefix) -> stored as ambiguous "x:..."; the account sees it as a channel
    const webk = await ctx
      .http()
      .post('/api/v1/client-groups')
      .set(bearer(admin))
      .send({ telegramChatId: '-1234567890', title: 'WebK', companyName: 'WebK Co' });
    expect(webk.body.telegramChatId).toBe('x:1234567890');
    tg.dialogs.push({ chatId: 'c:1234567890', title: 'WebK Co' });
    await tickets().createTicket({ clientGroupId: webk.body.id, text: 'webk muammo' });
    const hidden = await ctx
      .http()
      .post('/api/v1/client-groups')
      .set(bearer(admin))
      .send({ telegramChatId: '-1009999999999', title: 'Hidden', companyName: 'Hidden Co' });
    await tickets().createTicket({ clientGroupId: hidden.body.id, text: 'ko‘rinmas' });
    const r = await sync();
    expect(byTitle('🆕 Yangi')!.chatKeys).toEqual(['c:1234567890']);
    expect(r.warnings.some((w: string) => w.includes('Hidden Co'))).toBe(true);
    expect(byTitle('🆕 Yangi')!.chatKeys).not.toContain('c:9999999999');
    // and the ambiguous id does not cause an endless update loop
    expect((await sync()).plan.ops).toEqual([]);
  });

  it('a failing Telegram operation is isolated and logged; the next sync heals it', async () => {
    await seed();
    tg.failures.applyFolderOp = [new Error('DIALOG_FILTER_TITLE_EMPTY')];
    const r = await sync();
    expect(r.status).toBe('FAILED');
    expect(r.results.filter((x: { ok: boolean }) => !x.ok)).toHaveLength(1);
    expect(ours()).toHaveLength(4); // the other four were still created
    const failed = await ctx.prisma.folderOperation.findMany({ where: { ok: false } });
    expect(failed).toHaveLength(1);
    expect(failed[0].error).toContain('DIALOG_FILTER_TITLE_EMPTY');
    expect((await ctx.http().get('/api/v1/telegram/folders').set(bearer(admin))).body.lastRun.status).toBe(
      'FAILED',
    );
    expect((await sync()).status).toBe('OK');
    expect(ours()).toHaveLength(5);
  });

  it('concurrent syncs never duplicate folders (advisory lock)', async () => {
    await seed();
    const [a, b] = await pump(
      Promise.all([
        ctx
          .http()
          .post('/api/v1/telegram/folders/sync')
          .set(bearer(admin))
          .then((r) => r.body),
        ctx
          .http()
          .post('/api/v1/telegram/folders/sync')
          .set(bearer(admin))
          .then((r) => r.body),
      ]),
    );
    for (const s of [a.status, b.status]) expect(['OK', 'BUSY']).toContain(s);
    expect(new Set(tg.folders.map((f) => f.title)).size).toBe(tg.folders.length); // no duplicate folders
    expect(await ctx.prisma.telegramFolderState.count()).toBe(5);
  });

  it('a burst of ticket events is collapsed into ONE debounced sync', async () => {
    await seed();
    await settings({ 'funnel.reconcileDebounceSeconds': 1 });
    const spy = jest.spyOn(folders(), 'sync');
    await Promise.all(Array.from({ length: 5 }, () => folders().requestReconcile('event')));
    expect(spy).not.toHaveBeenCalled(); // still inside the debounce window
    const end = Date.now() + 5000;
    while (spy.mock.calls.length === 0 && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    await pump(spy.mock.results[0].value as Promise<unknown>);
    await new Promise((r) => setTimeout(r, 1500)); // nothing else may fire afterwards
    expect(spy).toHaveBeenCalledTimes(1);
    expect(ours()).toHaveLength(5);
    spy.mockRestore();
  });

  it('only admins can see folder state, preview, sync and the operation log', async () => {
    const u = await ctx
      .http()
      .post('/api/v1/users')
      .set(bearer(admin))
      .send({ username: 'oddiy', displayName: 'Oddiy', password: 'Temp-password-1' });
    void u;
    const l = await ctx.login('oddiy', 'Temp-password-1');
    const t = (
      await ctx
        .http()
        .post('/api/v1/auth/change-password')
        .set(bearer(l.accessToken))
        .send({ currentPassword: 'Temp-password-1', newPassword: 'Staff-new-pass-1' })
    ).body.accessToken;
    for (const [m, p] of [
      ['get', '/telegram/folders'],
      ['get', '/telegram/folders/preview'],
      ['post', '/telegram/folders/sync'],
      ['get', '/telegram/folders/log'],
    ] as const) {
      expect((await ctx.http()[m](`/api/v1${p}`).set(bearer(t))).status).toBe(403);
    }
  });
});
