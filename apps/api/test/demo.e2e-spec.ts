import { adminToken, bearer, createTestApp, TestCtx } from './helpers';
import { DemoSeedService } from '../src/demo/demo-seed.service';

describe('DEMO_MODE seed (e2e)', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    process.env.DEMO_MODE = 'true';
    process.env.DEMO_PASSWORD = 'Demo-password-123';
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
    delete process.env.DEMO_MODE;
    delete process.env.DEMO_PASSWORD;
  });
  beforeEach(async () => {
    await ctx.reset();
  });

  it('fills an empty system with usable fictional data, once', async () => {
    const seed = ctx.app.get(DemoSeedService);
    expect(await seed.seed()).toBe(true);

    expect(await ctx.prisma.clientGroup.count()).toBe(4);
    expect(await ctx.prisma.template.count()).toBeGreaterThanOrEqual(4);
    expect(await ctx.prisma.kbArticle.count({ where: { status: 'APPROVED' } })).toBeGreaterThanOrEqual(4);
    // none of the fake chats can be a real one
    const chats = await ctx.prisma.clientGroup.findMany({ select: { telegramChatId: true } });
    expect(chats.every((c) => c.telegramChatId.startsWith('c:900000000'))).toBe(true);

    // demo staff can log in directly with the env password (no forced change), the password is not in the DB in clear
    const l = await ctx.login('demo.ali', 'Demo-password-123');
    expect(l.status).toBe(200);
    const row = await ctx.prisma.user.findUniqueOrThrow({ where: { username: 'demo.ali' } });
    expect(row.passwordHash).not.toContain('Demo-password-123');

    // the data is consistent with the real logic: board, dashboard and statistics have something to show
    const admin = await adminToken(ctx);
    const dash = (await ctx.http().get('/api/v1/stats/dashboard').set(bearer(admin))).body;
    expect(dash.open.total).toBe(4);
    expect(dash.open.unassigned).toBe(1);
    expect(dash.open.overdue).toBe(1);
    expect(dash.open.waiting).toBe(1);
    const ov = (await ctx.http().get('/api/v1/stats/overview?days=30').set(bearer(admin))).body;
    expect(ov.totals.closed).toBeGreaterThanOrEqual(10);
    expect(ov.firstResponse.avgMin).not.toBeNull();
    const board = (await ctx.http().get('/api/v1/funnel/board').set(bearer(admin))).body;
    expect(board.columns.length).toBeGreaterThanOrEqual(4);

    // idempotent: a second call (or a restart) adds nothing
    expect(await seed.seed()).toBe(false);
    expect(await ctx.prisma.clientGroup.count()).toBe(4);
    expect(await ctx.prisma.ticket.count()).toBe(16);
  });

  it('never touches a system that already has data', async () => {
    await ctx.prisma.clientGroup.create({
      data: { telegramChatId: 'c:1', title: 'Real', companyName: 'Real Co', isConfirmed: true },
    });
    expect(await ctx.app.get(DemoSeedService).seed()).toBe(false);
    expect(await ctx.prisma.ticket.count()).toBe(0);
    expect(await ctx.prisma.user.count({ where: { username: 'demo.ali' } })).toBe(0);
  });
});
