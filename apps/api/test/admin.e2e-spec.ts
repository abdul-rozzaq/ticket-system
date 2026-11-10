import { adminToken, bearer, createTestApp, TestCtx } from './helpers';
import { TicketsService } from '../src/tickets/tickets.service';
import { csvCell } from '../src/admin/stats.service';

describe('admin API: audit, SLA policies, statistics (e2e)', () => {
  let ctx: TestCtx;
  let admin: string;
  let staff: { id: string; token: string };
  const groups: string[] = [];
  const tickets = () => ctx.app.get(TicketsService);

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await ctx.reset();
    admin = await adminToken(ctx);
    const u = await ctx
      .http()
      .post('/api/v1/users')
      .set(bearer(admin))
      .send({ username: 'ali', displayName: 'Ali', password: 'Temp-password-1' });
    const l = await ctx.login('ali', 'Temp-password-1');
    const c = await ctx
      .http()
      .post('/api/v1/auth/change-password')
      .set(bearer(l.accessToken))
      .send({ currentPassword: 'Temp-password-1', newPassword: 'Staff-new-pass-1' });
    staff = { id: u.body.id, token: c.body.accessToken };
    groups.length = 0;
    for (let i = 1; i <= 3; i++) {
      const g = await ctx
        .http()
        .post('/api/v1/client-groups')
        .set(bearer(admin))
        .send({
          telegramChatId: `-100${i}00000000${i}`,
          title: `G${i}`,
          companyName: `Company ${i}`,
          systemType: i === 3 ? 'PBX' : 'AMOCRM',
        });
      groups.push(g.body.id);
    }
  });

  describe('audit log', () => {
    it('is admin only, paginated and filterable; includes who did what', async () => {
      expect((await ctx.http().get('/api/v1/audit').set(bearer(staff.token))).status).toBe(403);
      const all = await ctx.http().get('/api/v1/audit?pageSize=5').set(bearer(admin));
      expect(all.status).toBe(200);
      expect(all.body.items.length).toBeLessThanOrEqual(5);
      expect(all.body.total).toBeGreaterThan(5); // logins, user and group creation ...
      expect(all.body.actions).toEqual(
        expect.arrayContaining(['auth.login', 'user.create', 'client_group.create']),
      );
      const logins = await ctx.http().get('/api/v1/audit?action=auth.login').set(bearer(admin));
      expect(logins.body.items.every((i: { action: string }) => i.action === 'auth.login')).toBe(true);
      expect(logins.body.items[0].actor).toMatchObject({ username: expect.any(String) });
      const search = await ctx.http().get('/api/v1/audit?q=client_group').set(bearer(admin));
      expect(search.body.total).toBe(3);
      const future = await ctx
        .http()
        .get(`/api/v1/audit?from=${encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString())}`)
        .set(bearer(admin));
      expect(future.body.total).toBe(0);
      expect((await ctx.http().get('/api/v1/audit?pageSize=9999').set(bearer(admin))).status).toBe(400);
    });
  });

  describe('SLA policies', () => {
    const mk = (body: object) => ctx.http().post('/api/v1/sla-policies').set(bearer(admin)).send(body);

    it('CRUD is admin only, only one default, in-use policies cannot be deleted', async () => {
      expect(
        (
          await ctx
            .http()
            .post('/api/v1/sla-policies')
            .set(bearer(staff.token))
            .send({ name: 'x', firstResponseMinutes: 5, resolutionMinutes: 60 })
        ).status,
      ).toBe(403);
      expect((await ctx.http().get('/api/v1/sla-policies').set(bearer(staff.token))).status).toBe(200); // read-only for staff
      const a = (
        await mk({ name: 'Standart', firstResponseMinutes: 30, resolutionMinutes: 480, isDefault: true })
      ).body;
      const b = (await mk({ name: 'VIP', firstResponseMinutes: 10, resolutionMinutes: 120, isDefault: true }))
        .body;
      const list = (await ctx.http().get('/api/v1/sla-policies').set(bearer(admin))).body;
      expect(
        list.filter((p: { isDefault: boolean }) => p.isDefault).map((p: { name: string }) => p.name),
      ).toEqual(['VIP']);
      expect(
        (
          await ctx
            .http()
            .put(`/api/v1/sla-policies/${a.id}`)
            .set(bearer(admin))
            .send({ name: 'Standart', firstResponseMinutes: 45, resolutionMinutes: 600, isDefault: true })
        ).body.firstResponseMinutes,
      ).toBe(45);
      expect(
        (await ctx.http().get('/api/v1/sla-policies').set(bearer(admin))).body.filter(
          (p: { isDefault: boolean }) => p.isDefault,
        ),
      ).toHaveLength(1);
      expect((await mk({ name: 'bad', firstResponseMinutes: 0, resolutionMinutes: 5 })).status).toBe(400);

      await ctx
        .http()
        .patch(`/api/v1/client-groups/${groups[0]}`)
        .set(bearer(admin))
        .send({ slaPolicyId: b.id });
      const del = await ctx.http().delete(`/api/v1/sla-policies/${b.id}`).set(bearer(admin));
      expect(del.status).toBe(409);
      expect(del.body.code).toBe('IN_USE');
      await ctx
        .http()
        .patch(`/api/v1/client-groups/${groups[0]}`)
        .set(bearer(admin))
        .send({ slaPolicyId: null });
      expect((await ctx.http().delete(`/api/v1/sla-policies/${b.id}`).set(bearer(admin))).status).toBe(204);
      expect(
        await ctx.prisma.auditLog.count({ where: { action: { startsWith: 'sla.' } } }),
      ).toBeGreaterThanOrEqual(4);
    });

    it('the policy really drives ticket deadlines: group policy > default policy > global settings', async () => {
      const vip = (await mk({ name: 'VIP', firstResponseMinutes: 10, resolutionMinutes: 120 })).body;
      await ctx
        .http()
        .patch(`/api/v1/client-groups/${groups[0]}`)
        .set(bearer(admin))
        .send({ slaPolicyId: vip.id });
      const t1 = (await tickets().createTicket({ clientGroupId: groups[0], text: 'vip muammo' })).ticket;
      expect(t1.slaDeadline.getTime() - t1.openedAt.getTime()).toBe(10 * 60_000);
      await tickets().attachMessage(t1.id, 'c:1000000001', {
        direction: 'OUT',
        text: 'javob',
        telegramMessageId: 1n,
      });
      const after = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: t1.id } });
      expect(after.slaDeadline.getTime() - after.openedAt.getTime()).toBe(120 * 60_000); // after the first reply: resolution deadline

      // no group policy and no default policy: global settings (30 / 480)
      const t2 = (await tickets().createTicket({ clientGroupId: groups[1], text: 'oddiy muammo' })).ticket;
      expect(t2.slaDeadline.getTime() - t2.openedAt.getTime()).toBe(30 * 60_000);
      await ctx
        .http()
        .put('/api/v1/sla-policies/' + vip.id)
        .set(bearer(admin))
        .send({ name: 'VIP', firstResponseMinutes: 10, resolutionMinutes: 120, isDefault: true });
      const t3 = (await tickets().createTicket({ clientGroupId: groups[2], text: 'default policy muammo' }))
        .ticket;
      expect(t3.slaDeadline.getTime() - t3.openedAt.getTime()).toBe(10 * 60_000); // the default policy applies to groups without their own
    });
  });

  describe('statistics', () => {
    const mkTicket = async (
      group: number,
      o: { openedMin: number; firstMin?: number; closedMin?: number; staff?: boolean; system?: string },
    ) => {
      const base = new Date(Date.now() - o.openedMin * 60_000);
      const { ticket } = await tickets().createTicket({
        clientGroupId: groups[group],
        text: `muammo ${group}`,
      });
      await ctx.prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          openedAt: base,
          slaDeadline: new Date(base.getTime() + 30 * 60_000),
          assigneeId: o.staff ? staff.id : null,
          status: o.closedMin !== undefined ? 'CLOSED' : 'IN_PROGRESS',
          firstResponseAt: o.firstMin !== undefined ? new Date(base.getTime() + o.firstMin * 60_000) : null,
          closedAt: o.closedMin !== undefined ? new Date(base.getTime() + o.closedMin * 60_000) : null,
          closedById: o.closedMin !== undefined && o.staff ? staff.id : null,
        },
      });
      return ticket;
    };

    it('dashboard: today, live funnel numbers and "mine" for staff', async () => {
      await mkTicket(0, { openedMin: 5, staff: true });
      await mkTicket(1, { openedMin: 200 }); // unassigned and past its 30 min SLA
      await mkTicket(2, { openedMin: 10, firstMin: 2, closedMin: 8, staff: true });
      const d = (await ctx.http().get('/api/v1/stats/dashboard').set(bearer(staff.token))).body;
      expect(d.open).toMatchObject({ total: 2, unassigned: 1, overdue: 1 });
      expect(d.mine).toMatchObject({ open: 1, overdue: 0, closedToday: expect.any(Number) });
      expect(d.today.opened).toBeGreaterThanOrEqual(2);
      expect((await ctx.http().get('/api/v1/stats/dashboard').set(bearer(admin))).body.mine).toMatchObject({
        open: 0,
      });
    });

    it('overview: response/resolution times, SLA compliance, per staff / client / system, AI quality — admin only', async () => {
      await mkTicket(0, { openedMin: 600, firstMin: 10, closedMin: 100, staff: true });
      await mkTicket(0, { openedMin: 500, firstMin: 20, closedMin: 200, staff: true });
      await mkTicket(1, { openedMin: 400, firstMin: 90, closedMin: 300, staff: true }); // missed the 30 min SLA
      await mkTicket(2, { openedMin: 300 }); // never answered and long overdue -> counted as a miss
      const g4 = await ctx
        .http()
        .post('/api/v1/client-groups')
        .set(bearer(admin))
        .send({ telegramChatId: '-1004000000004', title: 'G4', companyName: 'Company 4', systemType: 'PBX' });
      groups.push(g4.body.id);
      await mkTicket(3, { openedMin: 3 }); // still inside its window -> not counted

      // AI intake quality: 2 messages filtered by AI, one was later turned into a ticket by a human
      const g = groups[0];
      await ctx.prisma.filteredMessage.createMany({
        data: [
          { clientGroupId: g, text: 'a', reason: 'AI_NOT_REQUEST' },
          {
            clientGroupId: g,
            text: 'b',
            reason: 'AI_NOT_REQUEST',
            createdTicketId: (await ctx.prisma.ticket.findFirstOrThrow()).id,
          },
        ],
      });

      expect((await ctx.http().get('/api/v1/stats/overview').set(bearer(staff.token))).status).toBe(403);
      const o = (await ctx.http().get('/api/v1/stats/overview?days=7').set(bearer(admin))).body;
      expect(o.totals).toMatchObject({ opened: 5, closed: 3, open: 2 });
      expect(o.firstResponse).toMatchObject({ avgMin: 40, medianMin: 20, answered: 3 });
      expect(o.resolution).toMatchObject({ avgMin: 200 - 0, medianMin: expect.any(Number) });
      expect(o.sla).toMatchObject({ measured: 4, met: 2, compliancePct: 50 });
      expect(o.byStaff[0]).toMatchObject({ name: 'Ali', closed: 3, assigned: 3 });
      expect(o.byClient[0]).toMatchObject({ company: expect.stringMatching(/Company/) });
      expect(o.bySystem).toEqual([
        { systemType: 'AMOCRM', count: 3 },
        { systemType: 'PBX', count: 2 },
      ]);
      expect(o.byHour).toHaveLength(24);
      expect(o.byHour.reduce((a: number, b: number) => a + b, 0)).toBe(5);
      expect(o.daily).toHaveLength(7);
      expect(o.daily.reduce((a: number, d: { opened: number }) => a + d.opened, 0)).toBe(5);
      expect(o.ai).toMatchObject({ filteredByAi: 2, falseNegatives: 1, falseNegativeRate: 50 });
      expect((await ctx.http().get('/api/v1/stats/overview?days=0').set(bearer(admin))).status).toBe(400);
    });

    it('overview on an empty system returns nulls instead of NaN', async () => {
      const o = (await ctx.http().get('/api/v1/stats/overview').set(bearer(admin))).body;
      expect(o.totals).toMatchObject({ opened: 0, closed: 0 });
      expect(o.firstResponse.avgMin).toBeNull();
      expect(o.sla.compliancePct).toBeNull();
    });

    it('CSV export: admin only, Excel-friendly, quotes and spreadsheet formulas are neutralised', async () => {
      const t = await mkTicket(0, { openedMin: 60, firstMin: 5, closedMin: 40, staff: true });
      await ctx.prisma.ticket.update({
        where: { id: t.id },
        data: { summary: '=HYPERLINK("http://evil","click"), "quoted"' },
      });
      expect((await ctx.http().get('/api/v1/stats/export.csv').set(bearer(staff.token))).status).toBe(403);
      const r = await ctx
        .http()
        .get('/api/v1/stats/export.csv?days=7')
        .set(bearer(admin))
        .buffer(true)
        .parse((res, cb) => {
          let d = '';
          res.setEncoding('utf8');
          res.on('data', (c) => (d += c));
          res.on('end', () => cb(null, d));
        });
      expect(r.headers['content-type']).toContain('text/csv');
      expect(r.headers['content-disposition']).toContain('tickets.csv');
      const text = r.body as unknown as string;
      expect(text.startsWith('﻿number,company,system')).toBe(true);
      expect(text).toContain('Company 1');
      expect(text).toContain(`"'=HYPERLINK(""http://evil"",""click""), ""quoted"""`);
      expect(text.trim().split('\r\n')).toHaveLength(2);
    });

    it('csvCell unit behaviour', () => {
      expect(csvCell('a,b')).toBe('"a,b"');
      expect(csvCell('=1+1')).toBe("'=1+1");
      expect(csvCell('+998901234567')).toBe("'+998901234567");
      expect(csvCell(null)).toBe('');
      expect(csvCell(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01T00:00:00.000Z');
      expect(csvCell('oddiy')).toBe('oddiy');
    });
  });

  describe('PATCH semantics', () => {
    it('a partial group update does not reset omitted fields; activating confirms a pending group', async () => {
      await ctx
        .http()
        .patch(`/api/v1/client-groups/${groups[0]}`)
        .set(bearer(admin))
        .send({ isActive: false, language: 'ru', systemType: 'PBX' })
        .expect(200);
      const r = await ctx
        .http()
        .patch(`/api/v1/client-groups/${groups[0]}`)
        .set(bearer(admin))
        .send({ companyName: 'Renamed' })
        .expect(200);
      expect(r.body).toMatchObject({
        companyName: 'Renamed',
        isActive: false,
        language: 'ru',
        systemType: 'PBX',
      });
      await ctx.prisma.clientGroup.update({ where: { id: groups[0] }, data: { isConfirmed: false } });
      const on = await ctx
        .http()
        .patch(`/api/v1/client-groups/${groups[0]}`)
        .set(bearer(admin))
        .send({ isActive: true })
        .expect(200);
      expect(on.body).toMatchObject({ isActive: true, isConfirmed: true });
    });

    it('a partial template update keeps keywords and isActive', async () => {
      const tpl = await ctx
        .http()
        .post('/api/v1/templates')
        .set(bearer(admin))
        .send({ title: 'T', bodyUz: 'Salom', keywords: ['a', 'b'], isActive: false })
        .expect(201);
      const r = await ctx
        .http()
        .patch(`/api/v1/templates/${tpl.body.id}`)
        .set(bearer(admin))
        .send({ title: 'T2' })
        .expect(200);
      expect(r.body).toMatchObject({ title: 'T2', keywords: ['a', 'b'], isActive: false });
    });
  });
});
