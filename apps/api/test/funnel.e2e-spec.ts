import { adminToken, bearer, createTestApp, TestCtx } from './helpers';
import { TicketsService } from '../src/tickets/tickets.service';

type Col = {
  key: string;
  kind: string;
  title: string;
  cards: Array<{ number: number; overdue: boolean; id: string }>;
};

describe('funnel: stages + Kanban board (e2e)', () => {
  let ctx: TestCtx;
  let admin: string;
  let staff: Array<{ id: string; token: string; name: string }>;
  const groups: string[] = [];
  const tickets = () => ctx.app.get(TicketsService);

  const board = async (q = '') =>
    ((await ctx.http().get(`/api/v1/funnel/board${q}`).set(bearer(staff[0].token))).body.columns ??
      []) as Col[];
  const col = (cols: Col[], key: string) => cols.find((c) => c.key === key)!;
  const move = (ticketId: string, to: string, token = staff[0].token, extra: object = {}) =>
    ctx
      .http()
      .post('/api/v1/funnel/move')
      .set(bearer(token))
      .send({ ticketId, to, ...extra });
  const open = async (i: number, extra: Partial<Parameters<TicketsService['createTicket']>[0]> = {}) =>
    (await tickets().createTicket({ clientGroupId: groups[i], text: `muammo ${i}`, ...extra })).ticket;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await ctx.reset();
    admin = await adminToken(ctx);
    const me = (await ctx.http().get('/api/v1/auth/me').set(bearer(admin))).body;
    await ctx
      .http()
      .patch(`/api/v1/users/${me.id}`)
      .set(bearer(admin))
      .send({ isActive: true, available: false });
    staff = [];
    for (const n of ['ali', 'vali']) {
      const u = await ctx
        .http()
        .post('/api/v1/users')
        .set(bearer(admin))
        .send({ username: n, displayName: n[0].toUpperCase() + n.slice(1), password: 'Temp-password-1' });
      const l = await ctx.login(n, 'Temp-password-1');
      const c = await ctx
        .http()
        .post('/api/v1/auth/change-password')
        .set(bearer(l.accessToken))
        .send({ currentPassword: 'Temp-password-1', newPassword: 'Staff-new-pass-1' });
      staff.push({ id: u.body.id, token: c.body.accessToken, name: u.body.displayName });
    }
    groups.length = 0;
    for (let i = 1; i <= 4; i++) {
      const g = await ctx
        .http()
        .post('/api/v1/client-groups')
        .set(bearer(admin))
        .send({
          telegramChatId: `-100${i}00000000${i}`,
          title: `G${i}`,
          companyName: `Company ${i}`,
          systemType: i % 2 ? 'AMOCRM' : 'PBX',
        });
      groups.push(g.body.id);
    }
  });

  it('seeds the four system stages in the spec’d order; admin edits titles/positions; Yangi and Yopilgan cannot be switched off', async () => {
    const st = (await ctx.http().get('/api/v1/funnel/stages').set(bearer(staff[0].token))).body;
    expect(st.map((s: { kind: string }) => s.kind)).toEqual(['NEW', 'WAITING', 'OVERDUE', 'CLOSED']);
    expect(st[0].title).toBe('🆕 Yangi');
    const waiting = st[1];
    expect(
      (
        await ctx
          .http()
          .put(`/api/v1/funnel/stages/${waiting.id}`)
          .set(bearer(staff[0].token))
          .send({ title: 'x' })
      ).status,
    ).toBe(403);
    const r = await ctx
      .http()
      .put(`/api/v1/funnel/stages/${waiting.id}`)
      .set(bearer(admin))
      .send({ title: '⏳ Javob kutilmoqda' });
    expect(r.body.title).toBe('⏳ Javob kutilmoqda');
    expect(
      (await ctx.http().put(`/api/v1/funnel/stages/${st[0].id}`).set(bearer(admin)).send({ isActive: false }))
        .status,
    ).toBe(400);
    expect(
      (await ctx.http().put(`/api/v1/funnel/stages/${st[3].id}`).set(bearer(admin)).send({ isActive: false }))
        .status,
    ).toBe(400);
  });

  it('board columns: Yangi → one column per staff member → Kutilmoqda → Kechikkan → Yopilgan', async () => {
    const cols = await board();
    expect(cols.map((c) => c.key)).toEqual([
      'NEW',
      `USER:${staff[0].id}`,
      `USER:${staff[1].id}`,
      'WAITING',
      'OVERDUE',
      'CLOSED',
    ]);
    expect(cols[1].title).toBe('👤 Ali');
  });

  it('every ticket sits in exactly one column; overdue is virtual and wins over the assignee column', async () => {
    const t1 = await open(0); // unassigned
    const t2 = await open(1);
    await tickets().take(t2.id, staff[0].id); // ali
    const t3 = await open(2);
    await tickets().take(t3.id, staff[1].id);
    await tickets().setStatus(t3.id, 'WAITING_CLIENT', staff[1].id); // waiting
    const t4 = await open(3);
    await tickets().take(t4.id, staff[0].id);
    await ctx.prisma.ticket.update({
      where: { id: t4.id },
      data: { slaDeadline: new Date(Date.now() - 60_000) },
    }); // SLA breached

    const cols = await board();
    const where = (n: number) => cols.filter((c) => c.cards.some((x) => x.number === n)).map((c) => c.key);
    expect(where(t1.number)).toEqual(['NEW']);
    expect(where(t2.number)).toEqual([`USER:${staff[0].id}`]);
    expect(where(t3.number)).toEqual(['WAITING']);
    expect(where(t4.number)).toEqual(['OVERDUE']); // not also in Ali's column
    expect(col(cols, 'OVERDUE').cards[0].overdue).toBe(true);
    expect(cols.reduce((n, c) => n + c.cards.length, 0)).toBe(4);
  });

  it('urgent cards first, then oldest; filters by staff / system / group; closed column shows recent closures only', async () => {
    const a = await open(0, { urgency: 'LOW' });
    const b = await open(1, { urgency: 'HIGH' });
    const c = await open(2);
    expect(col(await board(), 'NEW').cards.map((x) => x.number)).toEqual([b.number, c.number, a.number]);
    expect((await board('?systemType=PBX')).flatMap((x) => x.cards).map((x) => x.number)).toEqual([b.number]);
    expect((await board(`?clientGroupId=${groups[2]}`)).flatMap((x) => x.cards).map((x) => x.number)).toEqual(
      [c.number],
    );
    await tickets().take(a.id, staff[1].id);
    expect((await board(`?assigneeId=${staff[1].id}`)).flatMap((x) => x.cards).map((x) => x.number)).toEqual([
      a.number,
    ]);

    await tickets().close(b.id, staff[0].id, 'tayyor');
    const old = await open(3);
    await tickets().close(old.id, staff[0].id);
    await ctx.prisma.ticket.update({
      where: { id: old.id },
      data: { closedAt: new Date(Date.now() - 5 * 86_400_000) },
    });
    expect(col(await board(), 'CLOSED').cards.map((x) => x.number)).toEqual([b.number]);
  });

  it('a disabled optional stage disappears and its tickets fall back to the assignee / Yangi', async () => {
    const t = await open(0);
    await tickets().take(t.id, staff[0].id);
    await tickets().setStatus(t.id, 'WAITING_CLIENT', staff[0].id);
    const st = (await ctx.http().get('/api/v1/funnel/stages').set(bearer(admin))).body;
    await ctx
      .http()
      .put(`/api/v1/funnel/stages/${st.find((s: { kind: string }) => s.kind === 'WAITING').id}`)
      .set(bearer(admin))
      .send({ isActive: false });
    const cols = await board();
    expect(cols.map((c) => c.key)).not.toContain('WAITING');
    expect(col(cols, `USER:${staff[0].id}`).cards.map((x) => x.number)).toEqual([t.number]);
  });

  describe('drag & drop (move)', () => {
    it('Yangi → staff column assigns (first assignment) and logs the actor; staff → staff reassigns', async () => {
      const t = await open(0);
      const r = await move(t.id, `USER:${staff[0].id}`, staff[1].token);
      expect(r.body).toMatchObject({
        stage: `USER:${staff[0].id}`,
        status: 'IN_PROGRESS',
        assigneeId: staff[0].id,
      });
      const ev = await ctx.prisma.ticketEvent.findFirstOrThrow({
        where: { ticketId: t.id, type: 'ASSIGNED' },
      });
      expect(ev.actorId).toBe(staff[1].id);
      const r2 = await move(t.id, `USER:${staff[1].id}`);
      expect(r2.body.assigneeId).toBe(staff[1].id);
      expect(await ctx.prisma.ticketEvent.count({ where: { ticketId: t.id, type: 'REASSIGNED' } })).toBe(1);
    });

    it('→ Kutilmoqda sets WAITING_CLIENT; waiting → staff column resumes work', async () => {
      const t = await open(0);
      await move(t.id, `USER:${staff[0].id}`);
      expect((await move(t.id, 'WAITING')).body).toMatchObject({
        stage: 'WAITING',
        status: 'WAITING_CLIENT',
      });
      expect((await move(t.id, `USER:${staff[0].id}`)).body).toMatchObject({
        status: 'IN_PROGRESS',
        assigneeId: staff[0].id,
      });
      await move(t.id, 'WAITING');
      expect((await move(t.id, `USER:${staff[1].id}`)).body).toMatchObject({
        status: 'IN_PROGRESS',
        assigneeId: staff[1].id,
      });
    });

    it('→ Yangi unassigns (also from waiting) and → Yopilgan closes with a solution note', async () => {
      const t = await open(0);
      await move(t.id, `USER:${staff[0].id}`);
      expect((await move(t.id, 'NEW')).body).toMatchObject({ stage: 'NEW', status: 'NEW', assigneeId: null });
      await move(t.id, 'WAITING'); // unassigned + waiting
      expect((await move(t.id, 'NEW')).body).toMatchObject({ status: 'NEW', assigneeId: null });
      const done = await move(t.id, 'CLOSED', staff[0].token, { solutionNote: 'https qilindi' });
      expect(done.body.status).toBe('CLOSED');
      expect((await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).solutionNote).toBe(
        'https qilindi',
      );
    });

    it('Kechikkan is virtual (rejected); closed tickets cannot be dragged anywhere; bad targets are rejected', async () => {
      const t = await open(0);
      const overdue = await move(t.id, 'OVERDUE');
      expect(overdue.status).toBe(400);
      expect(overdue.body.code).toBe('VIRTUAL_STAGE');
      expect((await move(t.id, 'NOWHERE')).status).toBe(400);
      expect((await move(t.id, 'USER:00000000-0000-0000-0000-000000000000')).status).toBe(400); // unknown / inactive person
      await move(t.id, 'CLOSED');
      const reopen = await move(t.id, 'NEW');
      expect(reopen.status).toBe(409);
      expect(reopen.body.code).toBe('CLOSED');
    });

    it('moves are audited and a deactivated person’s tickets return to Yangi', async () => {
      const t = await open(0);
      await move(t.id, `USER:${staff[0].id}`);
      expect(await ctx.prisma.auditLog.count({ where: { action: 'funnel.move' } })).toBe(1);
      await ctx.http().patch(`/api/v1/users/${staff[0].id}`).set(bearer(admin)).send({ isActive: false });
      await new Promise((r) => setTimeout(r, 300)); // the event listener works asynchronously
      expect(await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({
        assigneeId: null,
        status: 'NEW',
      });
      const cols = (await ctx.http().get('/api/v1/funnel/board').set(bearer(staff[1].token))).body
        .columns as Col[];
      expect(cols.map((c) => c.key)).not.toContain(`USER:${staff[0].id}`); // their column is gone
      expect(col(cols, 'NEW').cards.map((x) => x.number)).toEqual([t.number]);
    });
  });
});
