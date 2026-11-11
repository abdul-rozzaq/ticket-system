import { adminToken, bearer, createTestApp, TestCtx } from './helpers';
import { TicketsService } from '../src/apps/tickets/tickets.service';

describe('tickets (e2e)', () => {
  let ctx: TestCtx;
  let admin: string;
  let groupId: string;
  const staff: Array<{ id: string; token: string }> = [];

  async function makeStaff(name: string) {
    const created = await ctx
      .http()
      .post('/api/v1/users')
      .set(bearer(admin))
      .send({ username: name, displayName: name, password: 'Temp-password-1' });
    const l = await ctx.login(name, 'Temp-password-1');
    const c = await ctx
      .http()
      .post('/api/v1/auth/change-password')
      .set(bearer(l.accessToken))
      .send({ currentPassword: 'Temp-password-1', newPassword: 'Staff-new-pass-1' });
    return { id: created.body.id as string, token: c.body.accessToken as string };
  }

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await ctx.reset();
    admin = await adminToken(ctx);
    staff.length = 0;
    for (const n of ['ali', 'vali', 'sardor']) staff.push(await makeStaff(n));
    const g = await ctx.http().post('/api/v1/client-groups').set(bearer(admin)).send({
      telegramChatId: '-1001234567890',
      title: 'Orient Motors support',
      companyName: 'Orient Motors',
      systemType: 'AMOCRM',
    });
    groupId = g.body.id;
  });

  const svc = () => ctx.app.get(TicketsService);
  const open = (text = 'Webhook ulanmadi') =>
    svc().createTicket({ clientGroupId: groupId, text, senderName: 'Jasur' });

  it('open-chats: one row per open ticket with chat key and overdue flag, no message text; closed tickets are absent', async () => {
    const t = (await open('Maxfiy matn parol 123')).ticket;
    const rows = (await ctx.http().get('/api/v1/tickets/open-chats').set(bearer(staff[0].token))).body;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ticketId: t.id,
      status: 'NEW',
      overdue: false,
      chatKey: 'c:1234567890',
      company: 'Orient Motors',
    });
    expect(JSON.stringify(rows)).not.toContain('Maxfiy');
    await ctx.prisma.ticket.update({
      where: { id: t.id },
      data: { slaDeadline: new Date(Date.now() - 60_000) },
    });
    expect(
      (await ctx.http().get('/api/v1/tickets/open-chats').set(bearer(staff[0].token))).body[0].overdue,
    ).toBe(true);
    await ctx.http().post(`/api/v1/tickets/${t.id}/close`).set(bearer(staff[0].token)).send({});
    expect((await ctx.http().get('/api/v1/tickets/open-chats').set(bearer(staff[0].token))).body).toEqual([]);
    expect((await ctx.http().get('/api/v1/tickets/open-chats')).status).toBe(401);
  });

  it('normalises chat ids: WebA, WebK and by-chat lookup all find the same group', async () => {
    for (const id of ['-1001234567890', '-1234567890']) {
      const r = await ctx
        .http()
        .get(`/api/v1/client-groups/by-chat/${encodeURIComponent(id)}`)
        .set(bearer(staff[0].token));
      expect(r.status).toBe(200);
      expect(r.body.id).toBe(groupId);
    }
    expect(
      (await ctx.http().get('/api/v1/client-groups/by-chat/-1009999999999').set(bearer(staff[0].token)))
        .status,
    ).toBe(404);
    const dup = await ctx
      .http()
      .post('/api/v1/client-groups')
      .set(bearer(admin))
      .send({ telegramChatId: '-1001234567890', title: 'x', companyName: 'x' });
    expect(dup.status).toBe(409);
  });

  it('ticket lifecycle: create -> take -> wait -> client replies -> close -> new ticket links to previous', async () => {
    const { ticket, created } = await open();
    expect(created).toBe(true);
    expect(ticket.status).toBe('NEW');

    const taken = await ctx.http().post(`/api/v1/tickets/${ticket.id}/take`).set(bearer(staff[0].token));
    expect(taken.status).toBe(200);
    expect(taken.body).toMatchObject({ status: 'IN_PROGRESS', assigneeId: staff[0].id });

    const waiting = await ctx
      .http()
      .post(`/api/v1/tickets/${ticket.id}/status`)
      .set(bearer(staff[0].token))
      .send({ status: 'WAITING_CLIENT' });
    expect(waiting.body.status).toBe('WAITING_CLIENT');

    // client writes again -> back to IN_PROGRESS (assigned)
    await svc().attachMessage(ticket.id, '-1001234567890', {
      direction: 'IN',
      text: 'Skrinshot yubordim',
      telegramMessageId: 5n,
    });
    expect((await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe(
      'IN_PROGRESS',
    );

    const closed = await ctx
      .http()
      .post(`/api/v1/tickets/${ticket.id}/close`)
      .set(bearer(staff[0].token))
      .send({ solutionNote: 'https qilindi' });
    expect(closed.body).toMatchObject({
      status: 'CLOSED',
      solutionNote: 'https qilindi',
      closedById: staff[0].id,
    });
    expect(closed.body.closedAt).toBeTruthy();

    // closed tickets are never reopened
    const reopen = await ctx
      .http()
      .post(`/api/v1/tickets/${ticket.id}/status`)
      .set(bearer(staff[0].token))
      .send({ status: 'IN_PROGRESS' });
    expect(reopen.status).toBe(409);

    const next = await open('Yana muammo');
    expect(next.created).toBe(true);
    expect(next.ticket.previousTicketId).toBe(ticket.id);

    const detail = await ctx.http().get(`/api/v1/tickets/${ticket.id}`).set(bearer(staff[1].token));
    expect(detail.body.events.map((e: { type: string }) => e.type)).toEqual(
      expect.arrayContaining(['CREATED', 'ASSIGNED', 'STATUS_CHANGED', 'CLOSED']),
    );
  });

  it('one open ticket per group: a second creation attaches to the open ticket (also under concurrency)', async () => {
    const results = await Promise.all([open('a'), open('b'), open('c'), open('d')]);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.ticket.id)).size).toBe(1);
    expect(await ctx.prisma.ticket.count({ where: { clientGroupId: groupId } })).toBe(1);
    expect(await ctx.prisma.ticketMessage.count()).toBe(4); // all four messages attached
  });

  it('ATOMIC ASSIGNMENT: of many simultaneous "take" presses exactly one wins', async () => {
    const { ticket } = await open();
    const presses = await Promise.all(
      [0, 1, 2, 0, 1, 2, 0, 1, 2].map((i) =>
        ctx.http().post(`/api/v1/tickets/${ticket.id}/take`).set(bearer(staff[i].token)),
      ),
    );
    const winners = presses.filter((r) => r.status === 200);
    const losers = presses.filter((r) => r.status === 409);
    const winnerIds = new Set(winners.map((r) => r.body.assigneeId));
    expect(winnerIds.size).toBe(1); // everybody who "succeeded" is the same person (idempotent repeat presses)
    expect(winners.length + losers.length).toBe(9);
    expect(losers.every((r) => r.body.code === 'ALREADY_TAKEN')).toBe(true);

    const row = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect([...winnerIds][0]).toBe(row.assigneeId);
    const assignedEvents = await ctx.prisma.ticketEvent.count({
      where: { ticketId: ticket.id, type: 'ASSIGNED' },
    });
    expect(assignedEvents).toBe(1); // exactly one assignment was recorded
  });

  it('repeat "take" by the owner is an idempotent success; others get ALREADY_TAKEN with the owner name', async () => {
    const { ticket } = await open();
    expect(
      (await ctx.http().post(`/api/v1/tickets/${ticket.id}/take`).set(bearer(staff[0].token))).status,
    ).toBe(200);
    expect(
      (await ctx.http().post(`/api/v1/tickets/${ticket.id}/take`).set(bearer(staff[0].token))).status,
    ).toBe(200);
    const other = await ctx.http().post(`/api/v1/tickets/${ticket.id}/take`).set(bearer(staff[1].token));
    expect(other.status).toBe(409);
    expect(other.body.message).toContain('ali');
  });

  it('reassign with a handover note is recorded and emitted', async () => {
    const { ticket } = await open();
    await ctx.http().post(`/api/v1/tickets/${ticket.id}/take`).set(bearer(staff[0].token));
    const seen: unknown[] = [];
    const { DomainEvents } = await import('../src/common/domain-events');
    ctx.app.get(DomainEvents).on('ticket.assigned', (p) => seen.push(p));
    const r = await ctx
      .http()
      .post(`/api/v1/tickets/${ticket.id}/assign`)
      .set(bearer(staff[0].token))
      .send({ assigneeId: staff[1].id, handoverNote: 'Mijoz Bitrix ham ishlatadi' });
    expect(r.body.assigneeId).toBe(staff[1].id);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      previousAssigneeId: staff[0].id,
      handoverNote: 'Mijoz Bitrix ham ishlatadi',
    });
    const ev = await ctx.prisma.ticketEvent.findFirstOrThrow({
      where: { ticketId: ticket.id, type: 'REASSIGNED' },
    });
    expect(ev.payload).toMatchObject({ to: staff[1].id, handoverNote: 'Mijoz Bitrix ham ishlatadi' });
    // inactive users cannot be assigned
    await ctx.http().patch(`/api/v1/users/${staff[2].id}`).set(bearer(admin)).send({ isActive: false });
    expect(
      (
        await ctx
          .http()
          .post(`/api/v1/tickets/${ticket.id}/assign`)
          .set(bearer(admin))
          .send({ assigneeId: staff[2].id })
      ).status,
    ).toBe(400);
  });

  it('first outgoing message stamps firstResponseAt once and moves the SLA deadline to resolution', async () => {
    const { ticket } = await open();
    const before = ticket.slaDeadline.getTime();
    const [a, b] = await Promise.all([
      svc().attachMessage(ticket.id, '-1001234567890', {
        direction: 'OUT',
        text: "Ko'rib chiqamiz",
        telegramMessageId: 10n,
      }),
      svc().attachMessage(ticket.id, '-1001234567890', {
        direction: 'OUT',
        text: 'Salom',
        telegramMessageId: 11n,
      }),
    ]);
    expect([a.firstResponse, b.firstResponse].filter(Boolean)).toHaveLength(1);
    const row = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(row.firstResponseAt).toBeTruthy();
    expect(row.slaDeadline.getTime()).toBeGreaterThan(before);
    // redelivery of the same Telegram message is ignored
    const dup = await svc().attachMessage(ticket.id, '-1001234567890', {
      direction: 'OUT',
      text: 'Salom',
      telegramMessageId: 11n,
    });
    expect(dup.duplicate).toBe(true);
  });

  it('internal notes are stored but never count as a response', async () => {
    const { ticket } = await open();
    expect(
      (
        await ctx
          .http()
          .post(`/api/v1/tickets/${ticket.id}/note`)
          .set(bearer(staff[0].token))
          .send({ text: 'Mijoz bilan telefon orqali gaplashildi' })
      ).status,
    ).toBe(204);
    const row = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(row.firstResponseAt).toBeNull();
    expect(
      await ctx.prisma.ticketMessage.count({ where: { ticketId: ticket.id, isInternalNote: true } }),
    ).toBe(1);
  });

  it('merges two open tickets of different groups', async () => {
    const g2 = await ctx
      .http()
      .post('/api/v1/client-groups')
      .set(bearer(admin))
      .send({ telegramChatId: '-1005555555555', title: 'Orient 2', companyName: 'Orient Motors 2' });
    const a = (await open('birinchi')).ticket;
    const b = (await svc().createTicket({ clientGroupId: g2.body.id, text: 'ikkinchi' })).ticket;
    const r = await ctx
      .http()
      .post(`/api/v1/tickets/${b.id}/merge`)
      .set(bearer(staff[0].token))
      .send({ targetId: a.id });
    expect(r.status).toBe(200);
    const src = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: b.id } });
    expect(src).toMatchObject({ status: 'CLOSED', mergedIntoId: a.id });
    expect(await ctx.prisma.ticketMessage.count({ where: { ticketId: a.id } })).toBe(2);
  });

  it('lists with filters/pagination and returns the by-chat view for the extension', async () => {
    const { ticket } = await open();
    await ctx.http().post(`/api/v1/tickets/${ticket.id}/take`).set(bearer(staff[1].token));
    const list = await ctx
      .http()
      .get(`/api/v1/tickets?assigneeId=${staff[1].id}&pageSize=10`)
      .set(bearer(staff[0].token));
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].clientGroup.companyName).toBe('Orient Motors');
    const search = await ctx.http().get(`/api/v1/tickets?q=orient`).set(bearer(staff[0].token));
    expect(search.body.total).toBe(1);
    expect((await ctx.http().get('/api/v1/tickets?pageSize=1000').set(bearer(staff[0].token))).status).toBe(
      400,
    );

    const byChat = await ctx.http().get('/api/v1/tickets/by-chat/-1234567890').set(bearer(staff[0].token));
    expect(byChat.body.current.id).toBe(ticket.id);
    expect(byChat.body.lastClosed).toBeNull();
  });

  it('the default summary never stores a raw secret', async () => {
    const { ticket } = await svc().createTicket({
      clientGroupId: groupId,
      text: 'parol: Hunter22secret, token sk-ant-api03-abcdefghijklmnopqrstuv',
    });
    expect(ticket.summary).not.toContain('Hunter22secret');
    expect(ticket.summary).not.toContain('abcdefghijklmnopqrstuv');
    expect(ticket.summary).toContain('[PAROL]');
  });

  it('templates: admin CRUD, staff read + usage counter', async () => {
    const t = await ctx
      .http()
      .post('/api/v1/templates')
      .set(bearer(admin))
      .send({ category: 'AmoCRM', title: 'Webhook', bodyUz: 'Salom {mijoz_nomi}', keywords: ['webhook'] });
    expect(t.status).toBe(201);
    expect(
      (
        await ctx
          .http()
          .post('/api/v1/templates')
          .set(bearer(staff[0].token))
          .send({ title: 'x', bodyUz: 'y' })
      ).status,
    ).toBe(403);
    await Promise.all(
      [1, 2, 3].map(() => ctx.http().post(`/api/v1/templates/${t.body.id}/use`).set(bearer(staff[0].token))),
    );
    const list = await ctx.http().get('/api/v1/templates').set(bearer(staff[0].token));
    expect(list.body[0].usageCount).toBe(3);
  });
});
