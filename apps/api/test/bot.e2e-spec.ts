import { userShortId } from '@tp/shared';
import { adminToken, bearer, createTestApp, TestCtx } from './helpers';
import { TicketsService } from '../src/tickets/tickets.service';
import { RemindersService } from '../src/bot/reminders.service';
import { BotNotifier } from '../src/bot/bot-notifier.service';

const GROUP_CHAT = '-1009990001'; // the internal Telegram group
type Staff = { id: string; token: string; tg: string; name: string };

describe('internal bot (e2e)', () => {
  let ctx: TestCtx;
  let admin: string;
  let groupId: string;
  let staff: Staff[];

  const svc = () => ctx.svc();
  const cb = (tg: string, data: string) =>
    ctx.http().post('/api/v1/internal/bot/callbacks').set(svc()).send({ telegramUserId: tg, data });
  const cmd = (tg: string, text: string, chatType = 'private') =>
    ctx.http().post('/api/v1/internal/bot/commands').set(svc()).send({ telegramUserId: tg, chatType, text });
  const outbox = (kind?: string) =>
    ctx.prisma.botOutbox.findMany({ where: kind ? { kind } : {}, orderBy: { createdAt: 'asc' } });
  const tickets = () => ctx.app.get(TicketsService);
  const reminders = () => ctx.app.get(RemindersService);
  const open = async (text = 'Webhook ulanmadi, lidlar tushmayapti') => {
    const r = await tickets().createTicket({
      clientGroupId: groupId,
      text,
      senderName: 'Jasur',
      urgency: 'HIGH',
      summary: 'Webhook ishlamayapti',
    });
    await new Promise((r) => setTimeout(r, 150)); // let the (async) event listeners enqueue
    return r.ticket;
  };
  const settle = () => new Promise((r) => setTimeout(r, 150));

  async function makeStaff(name: string, tg: string): Promise<Staff> {
    const u = await ctx
      .http()
      .post('/api/v1/users')
      .set(bearer(admin))
      .send({
        username: name,
        displayName: name[0].toUpperCase() + name.slice(1),
        password: 'Temp-password-1',
      });
    const l = await ctx.login(name, 'Temp-password-1');
    const c = await ctx
      .http()
      .post('/api/v1/auth/change-password')
      .set(bearer(l.accessToken))
      .send({ currentPassword: 'Temp-password-1', newPassword: 'Staff-new-pass-1' });
    // link through the real flow: admin issues a code, the person sends /start <code> to the bot in a private chat
    const code = (await ctx.http().post(`/api/v1/users/${u.body.id}/telegram-code`).set(bearer(admin))).body
      .code;
    const linked = await cmd(tg, `/start ${code}`);
    expect(linked.body.replies[0].text).toContain('bog');
    return { id: u.body.id, token: c.body.accessToken, tg, name: u.body.displayName };
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
    const me = (await ctx.http().get('/api/v1/auth/me').set(bearer(admin))).body;
    await ctx.http().patch(`/api/v1/users/${me.id}`).set(bearer(admin)).send({ available: false }); // keep the admin out of the card
    staff = [await makeStaff('ali', '1001'), await makeStaff('vali', '1002')];
    const g = await ctx.http().post('/api/v1/client-groups').set(bearer(admin)).send({
      telegramChatId: '-1001234567890',
      title: 'Orient',
      companyName: 'Orient Motors',
      systemType: 'AMOCRM',
    });
    groupId = g.body.id;
    await ctx
      .http()
      .put('/api/v1/telegram/bot')
      .set(bearer(admin))
      .send({ internalChatId: GROUP_CHAT, escalationUserId: staff[1].id });
    await ctx.prisma.botOutbox.deleteMany(); // drop anything produced during setup
  });

  describe('configuration', () => {
    it('is admin only; the token is write-only and encrypted; bad tokens are rejected', async () => {
      expect((await ctx.http().get('/api/v1/telegram/bot').set(bearer(staff[0].token))).status).toBe(403);
      expect(
        (await ctx.http().put('/api/v1/telegram/bot').set(bearer(admin)).send({ token: 'not-a-token' }))
          .status,
      ).toBe(400);
      const token = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ';
      const r = await ctx.http().put('/api/v1/telegram/bot').set(bearer(admin)).send({ token });
      expect(JSON.stringify(r.body)).not.toContain('AAHdqTcv');
      expect(r.body).toMatchObject({ hasToken: true, internalChatId: GROUP_CHAT });
      const row = await ctx.prisma.setting.findUniqueOrThrow({ where: { key: 'bot.config' } });
      expect(JSON.stringify(row.value)).not.toContain('AAHdqTcv');
      expect((await ctx.http().get('/api/v1/internal/bot/config').set(svc())).body).toEqual({
        token,
        internalChatId: GROUP_CHAT,
      });
      expect((await ctx.http().get('/api/v1/internal/bot/config')).status).toBe(401);
    });
  });

  describe('new-ticket card', () => {
    it('is enqueued for the internal group with the spec’d keyboard', async () => {
      const tk = await open('parol: Hunter22secret, webhook ulanmadi');
      const [item] = await outbox('SEND_CARD');
      const p = item.payload as {
        chatId: string;
        text: string;
        keyboard: Array<Array<{ text: string; callback?: string; url?: string }>>;
      };
      expect(p.chatId).toBe(GROUP_CHAT);
      expect(p.text).toContain(`#${tk.number}`);
      expect(p.text).toContain('Orient Motors');
      expect(p.text).not.toContain('Hunter22secret'); // secrets never go to a Telegram group
      expect(p.keyboard[0][0]).toEqual({ text: '🙋 Men olaman', callback: `k:${tk.number}` });
      const labels = p.keyboard.flat().map((b) => b.text);
      expect(labels).toEqual(
        expect.arrayContaining(['👤 Ali (0)', '👤 Vali (0)', '⏭ Keyinroq', '🔗 Chatni ochish']),
      );
      expect(labels).not.toContain('👤 Admin (0)'); // the unavailable admin is not offered
    });

    it('does nothing (and does not fail ticket creation) when the internal group is not configured', async () => {
      await ctx.prisma.setting.deleteMany({ where: { key: 'bot.config' } });
      const tk = await open();
      expect(tk.status).toBe('NEW');
      expect(await outbox()).toHaveLength(0);
    });

    it('unavailable (/busy) staff are not offered on new cards', async () => {
      await cmd(staff[0].tg, '/busy');
      await open();
      const labels = (
        (await outbox('SEND_CARD'))[0].payload as { keyboard: Array<Array<{ text: string }>> }
      ).keyboard
        .flat()
        .map((b) => b.text);
      expect(labels).not.toContain('👤 Ali (0)');
      expect(labels).toContain('👤 Vali (0)');
    });
  });

  describe('outbox contract', () => {
    const claim = (wait = 0) => ctx.http().get(`/api/v1/internal/bot/outbox?wait=${wait}`).set(svc());
    const result = (id: string, body: object) =>
      ctx.http().post(`/api/v1/internal/bot/outbox/${id}/result`).set(svc()).send(body);

    it('claims each item once; the posted card id is stored and later events EDIT that card', async () => {
      const tk = await open();
      const c1 = (await claim()).body;
      expect(c1).toHaveLength(1);
      expect((await claim()).body).toHaveLength(0);
      await result(c1[0].id, { ok: true, result: { messageId: '777' } });
      const row = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: tk.id } });
      expect(row).toMatchObject({ cardChatId: GROUP_CHAT, cardMessageId: 777n });

      await tickets().take(tk.id, staff[0].id);
      await settle();
      const edits = await outbox('EDIT_CARD');
      expect(edits).toHaveLength(1);
      expect(edits[0].payload).toMatchObject({ chatId: GROUP_CHAT, messageId: '777' });
      expect((edits[0].payload as { text: string }).text).toContain('Ali tomonidan olindi');
    });

    it('a card assigned BEFORE the bot managed to post it is corrected right after it is posted', async () => {
      const tk = await open();
      const c1 = (await claim()).body;
      await tickets().take(tk.id, staff[0].id); // happens while the card is "in flight"
      await settle();
      expect(await outbox('EDIT_CARD')).toHaveLength(0); // no message id yet: nothing to edit
      await result(c1[0].id, { ok: true, result: { messageId: '55' } });
      await settle();
      const edits = await outbox('EDIT_CARD');
      expect(edits).toHaveLength(1);
      expect((edits[0].payload as { text: string }).text).toContain('Ali tomonidan olindi');
    });

    it('failed sends are retried up to 3 attempts, then marked FAILED', async () => {
      await open();
      for (let i = 1; i <= 3; i++) {
        const c = (await claim()).body;
        expect(c).toHaveLength(1);
        await result(c[0].id, { ok: false, error: 'Too Many Requests' });
      }
      expect((await claim()).body).toHaveLength(0);
      expect((await outbox())[0]).toMatchObject({ status: 'FAILED', attempts: 3 });
    });

    it('an item claimed by a bot that died is handed out again after 2 minutes', async () => {
      await open();
      const c = (await claim()).body;
      expect((await claim()).body).toHaveLength(0);
      await ctx.prisma.botOutbox.update({
        where: { id: c[0].id },
        data: { claimedAt: new Date(Date.now() - 3 * 60_000) },
      });
      expect((await claim()).body.map((x: { id: string }) => x.id)).toEqual([c[0].id]);
    });

    it('two concurrent pollers never receive the same item', async () => {
      for (let i = 0; i < 6; i++)
        await ctx.prisma.botOutbox.create({
          data: { kind: 'SEND_TEXT', payload: { chatId: '1', text: String(i) } },
        });
      const [a, b] = await Promise.all([claim(), claim()]);
      const ids = [...a.body, ...b.body].map((x: { id: string }) => x.id);
      expect(ids).toHaveLength(6);
      expect(new Set(ids).size).toBe(6);
    });
  });

  describe('button presses', () => {
    it('ATOMIC: staff pressing "Men olaman" at the same moment — exactly one wins, the loser is told who has it', async () => {
      const tk = await open();
      const presses = await Promise.all([
        cb(staff[0].tg, `k:${tk.number}`),
        cb(staff[1].tg, `k:${tk.number}`),
        cb(staff[0].tg, `k:${tk.number}`),
        cb(staff[1].tg, `k:${tk.number}`),
      ]);
      const row = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: tk.id } });
      const winner = staff.find((s) => s.id === row.assigneeId)!;
      const answers = presses.map((r) => r.body.answer as string);
      expect(answers.filter((a) => a.includes('tomonidan olindi'))).toHaveLength(2); // the winner (idempotent repeat included)
      const losers = presses.filter((r) => r.body.alert === true);
      expect(losers).toHaveLength(2);
      for (const l of losers) expect(l.body.answer).toContain(winner.name);
      expect(await ctx.prisma.ticketEvent.count({ where: { ticketId: tk.id, type: 'ASSIGNED' } })).toBe(1);
      // everybody gets the up-to-date card back
      for (const r of presses) expect(r.body.edit.text).toContain(`${winner.name} tomonidan olindi`);
    });

    it('a staff button assigns that person (actor = presser); the assignee gets a DM', async () => {
      const tk = await open();
      const r = await cb(staff[0].tg, `a:${tk.number}:${userShortId(staff[1].id)}`);
      expect(r.body.edit.text).toContain('Vali tomonidan olindi');
      const row = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: tk.id } });
      expect(row).toMatchObject({ assigneeId: staff[1].id, status: 'IN_PROGRESS' });
      const ev = await ctx.prisma.ticketEvent.findFirstOrThrow({
        where: { ticketId: tk.id, type: 'ASSIGNED' },
      });
      expect(ev.actorId).toBe(staff[0].id);
      await settle();
      const dms = (await outbox('SEND_TEXT')).filter(
        (o) => (o.payload as { chatId: string }).chatId === '1002',
      );
      expect(dms).toHaveLength(1);
      expect((dms[0].payload as { text: string }).text).toContain(`#${tk.number}`);
    });

    it('taking a ticket yourself sends no DM; a second staff button on an assigned ticket is a reassignment', async () => {
      const tk = await open();
      await cb(staff[0].tg, `k:${tk.number}`);
      await settle();
      expect((await outbox('SEND_TEXT')).length).toBe(0);
      const r = await cb(staff[0].tg, `a:${tk.number}:${userShortId(staff[1].id)}`);
      expect(r.body.edit.text).toContain('Vali');
      expect(await ctx.prisma.ticketEvent.count({ where: { ticketId: tk.id, type: 'REASSIGNED' } })).toBe(1);
    });

    it('reassign menu and back', async () => {
      const tk = await open();
      await cb(staff[0].tg, `k:${tk.number}`);
      const menu = await cb(staff[0].tg, `r:${tk.number}`);
      const data = menu.body.edit.keyboard.flat().map((b: { callback?: string }) => b.callback);
      expect(data).toEqual([
        `a:${tk.number}:${userShortId(staff[0].id)}`,
        `a:${tk.number}:${userShortId(staff[1].id)}`,
        `b:${tk.number}`,
      ]);
      const back = await cb(staff[0].tg, `b:${tk.number}`);
      expect(
        back.body.edit.keyboard.flat().some((b: { callback?: string }) => b.callback === `d:${tk.number}`),
      ).toBe(true);
    });

    it('wait and done; pressing buttons on a closed ticket just shows the closed card', async () => {
      const tk = await open();
      await cb(staff[0].tg, `k:${tk.number}`);
      expect((await cb(staff[0].tg, `w:${tk.number}`)).body.edit.text).toContain('Mijoz kutilmoqda');
      expect((await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: tk.id } })).status).toBe(
        'WAITING_CLIENT',
      );
      const done = await cb(staff[1].tg, `d:${tk.number}`);
      expect(done.body.edit.text).toContain('Yopilgan');
      const row = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: tk.id } });
      expect(row).toMatchObject({ status: 'CLOSED', closedById: staff[1].id });
      const again = await cb(staff[0].tg, `k:${tk.number}`);
      expect(again.body).toMatchObject({ alert: true });
      expect(again.body.edit.keyboard.flat().every((b: { callback?: string }) => !b.callback)).toBe(true);
    });

    it('ignores everybody who is not linked, active staff, and malformed data', async () => {
      const tk = await open();
      const stranger = await cb('999999', `k:${tk.number}`);
      expect(stranger.body).toMatchObject({ alert: true, edit: null });
      expect((await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: tk.id } })).assigneeId).toBeNull();
      await ctx.http().patch(`/api/v1/users/${staff[0].id}`).set(bearer(admin)).send({ isActive: false });
      expect((await cb(staff[0].tg, `k:${tk.number}`)).body.edit).toBeNull(); // deactivated people lose access immediately
      expect((await cb(staff[1].tg, 'garbage')).body.alert).toBe(true);
      expect((await cb(staff[1].tg, 'k:99999')).body.alert).toBe(true); // unknown ticket
      expect(
        (await ctx.http().post('/api/v1/internal/bot/callbacks').send({ telegramUserId: '1', data: 'k:1' }))
          .status,
      ).toBe(401);
    });

    it('snooze records a reminder and suppresses the "unassigned" nudge until it expires', async () => {
      const tk = await open();
      await cb(staff[0].tg, `s:${tk.number}`);
      expect(await ctx.prisma.reminder.count({ where: { kind: 'SNOOZE', ticketId: tk.id } })).toBe(1);
      const later = new Date(Date.now() + 11 * 60_000);
      // snooze (10 min) has expired by then
      const sent = await reminders().tick(later);
      expect(sent.unassigned).toBe(1);
    });
  });

  describe('commands', () => {
    it('/start <code> links only in a private chat; codes are single-use; wrong codes are refused', async () => {
      const u = await ctx
        .http()
        .post('/api/v1/users')
        .set(bearer(admin))
        .send({ username: 'sardor', displayName: 'Sardor', password: 'Temp-password-1' });
      const code = (await ctx.http().post(`/api/v1/users/${u.body.id}/telegram-code`).set(bearer(admin))).body
        .code;
      expect((await cmd('1003', `/start ${code}`, 'supergroup')).body.replies).toBeNull(); // never in a group
      expect((await cmd('1003', '/start WRONGCODE')).body.replies[0].text).toContain("noto'g'ri");
      expect((await cmd('1003', `/start ${code}`)).body.replies[0].text).toContain('Sardor');
      expect((await cmd('1004', `/start ${code}`)).body.replies[0].text).toContain("noto'g'ri"); // already used
      expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: u.body.id } })).telegramUserId).toBe(
        1003n,
      );
    });

    it('everyone who is not staff is ignored (no reply at all)', async () => {
      expect((await cmd('424242', '/my')).body.replies).toBeNull();
      expect((await cmd('424242', '/free')).body.replies).toBeNull();
      expect((await cmd('424242', '/start')).body.replies[0].text).toContain("bog'lanmagansiz");
    });

    it('/my lists my open tickets with done/wait buttons that work', async () => {
      const t1 = await open();
      await cb(staff[0].tg, `k:${t1.number}`);
      const my = (await cmd(staff[0].tg, '/my')).body.replies[0];
      expect(my.text).toContain(`#${t1.number}`);
      expect(my.text).toContain('Orient Motors');
      expect(my.keyboard.flat().map((b: { callback: string }) => b.callback)).toEqual([
        `d:${t1.number}`,
        `w:${t1.number}`,
      ]);
      expect((await cmd(staff[1].tg, '/my')).body.replies[0].text).toContain("yo'q"); // nothing assigned to Vali
      expect((await cb(staff[0].tg, my.keyboard[0][0].callback)).body.edit.text).toContain('Yopilgan');
    });

    it('/free and /busy toggle availability (and the @botname suffix works)', async () => {
      await cmd(staff[0].tg, '/busy@tp_support_bot');
      expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: staff[0].id } })).available).toBe(false);
      await cmd(staff[0].tg, '/free');
      expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: staff[0].id } })).available).toBe(true);
    });

    it('/stats and /help', async () => {
      const t1 = await open();
      await cb(staff[0].tg, `d:${t1.number}`);
      await open('Yana muammo bor, tekshiring');
      const s = (await cmd(staff[0].tg, '/stats')).body.replies[0].text;
      expect(s).toContain('2 ta yangi');
      expect(s).toContain('1 ta yopilgan (siz: 1)');
      expect(s).toContain('ochiq: 1');
      expect((await cmd(staff[0].tg, '/help')).body.replies[0].text).toContain('/my');
      expect((await cmd(staff[0].tg, '/nonsense')).body.replies).toBeNull();
      expect((await cmd(staff[0].tg, 'plain text')).body.replies).toBeNull();
    });
  });

  describe('reminders (time is injected into tick())', () => {
    const at = (min: number) => new Date(Date.now() + min * 60_000);
    // a tick after 09:00 local also produces the morning digest, so tests pick the message they care about
    const only = async (chatId: string, needle: string) =>
      (await texts(chatId)).filter((t) => t.includes(needle));
    const texts = async (chatId?: string) =>
      (await outbox('SEND_TEXT'))
        .map((o) => o.payload as { chatId: string; text: string })
        .filter((p) => !chatId || p.chatId === chatId)
        .map((p) => p.text);

    it('unassigned: one reminder per interval, escalation mention from the 2nd, never duplicated', async () => {
      const tk = await open();
      await ctx.prisma.botOutbox.deleteMany();
      expect((await reminders().tick(at(5))).unassigned).toBe(0); // too early
      expect((await reminders().tick(at(11))).unassigned).toBe(1);
      expect((await reminders().tick(at(11))).unassigned).toBe(0); // same interval: deduped
      const first = await texts(GROUP_CHAT);
      expect(first).toHaveLength(1);
      expect(first[0]).toContain(`#${tk.number}`);
      expect(first[0]).not.toContain('tg://user'); // no escalation yet

      expect((await reminders().tick(at(21))).unassigned).toBe(1);
      const second = (await texts(GROUP_CHAT))[1];
      expect(second).toContain(`tg://user?id=1002`); // Vali is the escalation person
      expect(second).toContain('Vali');
    });

    it('stops nagging once somebody takes the ticket', async () => {
      const tk = await open();
      await tickets().take(tk.id, staff[0].id);
      expect((await reminders().tick(at(60))).unassigned).toBe(0);
    });

    it('reply-to: reminders are threaded under the ticket’s card', async () => {
      const tk = await open();
      const c = (await outbox('SEND_CARD'))[0];
      await ctx
        .http()
        .post(`/api/v1/internal/bot/outbox/${c.id}/result`)
        .set(svc())
        .send({ ok: true, result: { messageId: '900' } });
      await ctx.prisma.botOutbox.deleteMany();
      await reminders().tick(at(11));
      expect(((await outbox('SEND_TEXT'))[0].payload as { replyToMessageId?: string }).replyToMessageId).toBe(
        '900',
      );
      void tk;
    });

    it('assigned but unresolved for N hours: DM to the assignee, once per interval', async () => {
      const tk = await open();
      await tickets().take(tk.id, staff[0].id);
      await ctx.prisma.botOutbox.deleteMany();
      expect((await reminders().tick(at(3 * 60))).stale).toBe(0); // 3 h < 4 h
      expect((await reminders().tick(at(4 * 60 + 5))).stale).toBe(1);
      expect((await reminders().tick(at(4 * 60 + 6))).stale).toBe(0);
      const dm = await only('1001', 'hal bo');
      expect(dm).toHaveLength(1);
      expect(dm[0]).toContain('4 soat');
    });

    it('DMs respect working hours / days off and are delivered once the person is back at work', async () => {
      const tk = await open();
      await tickets().take(tk.id, staff[0].id);
      // working hours 09:00-18:00 Mon-Fri Tashkent
      await ctx
        .http()
        .patch(`/api/v1/users/${staff[0].id}`)
        .set(bearer(admin))
        .send({ workingHours: { tz: 'Asia/Tashkent', days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00' } });
      await ctx.prisma.botOutbox.deleteMany();
      // Sunday 12:00 local, ticket "assigned" 5 h earlier: day off, nothing is sent and the key is NOT burned
      const sunday = new Date('2026-03-01T07:00:00Z');
      await ctx.prisma.ticketEvent.updateMany({
        where: { ticketId: tk.id, type: 'ASSIGNED' },
        data: { createdAt: new Date(sunday.getTime() - 5 * 3_600_000) },
      });
      await ctx.prisma.ticketEvent.updateMany({
        where: { ticketId: tk.id, type: 'STATUS_CHANGED' },
        data: { createdAt: new Date(sunday.getTime() - 5 * 3_600_000) },
      });
      expect((await reminders().tick(sunday)).stale).toBe(0);
      expect(await only('1001', 'hal bo')).toHaveLength(0);
      // Monday 10:00 local (05:00Z): back at work, reminder goes out
      const monday = new Date('2026-03-02T05:00:00Z');
      expect((await reminders().tick(monday)).stale).toBe(1);
      expect(await only('1001', 'hal bo')).toHaveLength(1);
    });

    it('waiting for the client for N hours: DM to the assignee', async () => {
      const tk = await open();
      await tickets().take(tk.id, staff[0].id);
      await tickets().setStatus(tk.id, 'WAITING_CLIENT', staff[0].id);
      await ctx.prisma.botOutbox.deleteMany();
      expect((await reminders().tick(at(23 * 60))).waiting).toBe(0);
      expect((await reminders().tick(at(24 * 60 + 5))).waiting).toBe(1);
      expect(await only('1001', 'mijoz javobini')).toHaveLength(1);
    });

    it('SLA breach: announced once, recorded as an event', async () => {
      const tk = await open();
      await ctx.prisma.ticket.update({
        where: { id: tk.id },
        data: { slaDeadline: new Date(Date.now() - 60_000) },
      });
      await ctx.prisma.botOutbox.deleteMany();
      expect((await reminders().tick()).overdue).toBe(1);
      expect((await reminders().tick()).overdue).toBe(0);
      expect((await texts(GROUP_CHAT))[0]).toContain('SLA muddati');
      expect(await ctx.prisma.ticketEvent.count({ where: { ticketId: tk.id, type: 'SLA_BREACHED' } })).toBe(
        1,
      );
    });

    it('morning digest: once per local day, from 09:00, skipping days off', async () => {
      const t1 = await open();
      await tickets().take(t1.id, staff[0].id);
      await ctx.prisma.botOutbox.deleteMany();
      const monday0800 = new Date('2026-03-02T03:00:00Z'); // 08:00 Tashkent
      const monday1000 = new Date('2026-03-02T05:00:00Z');
      expect((await reminders().tick(monday0800)).digest).toBe(0); // before 09:00
      expect((await reminders().tick(monday1000)).digest).toBe(2); // Ali and Vali
      expect((await reminders().tick(new Date('2026-03-02T09:00:00Z'))).digest).toBe(0); // same day
      const ali = await texts('1001');
      expect(ali[0]).toContain('1 ta ochiq tiket');
      expect((await texts('1002'))[0]).toContain('0 ta ochiq tiket');
      expect((await reminders().tick(new Date('2026-03-03T05:00:00Z'))).digest).toBe(2); // next day

      await ctx
        .http()
        .patch(`/api/v1/users/${staff[0].id}`)
        .set(bearer(admin))
        .send({ workingHours: { tz: 'Asia/Tashkent', days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00' } });
      expect((await reminders().tick(new Date('2026-03-08T05:00:00Z'))).digest).toBe(1); // Sunday: only Vali (no schedule)
    });
  });

  it('handover note reaches the new assignee’s DM', async () => {
    const tk = await open();
    await tickets().take(tk.id, staff[0].id);
    await ctx.prisma.botOutbox.deleteMany();
    await tickets().assign(tk.id, staff[1].id, staff[0].id, 'Mijoz Bitrix ham ishlatadi');
    await settle();
    const dm = (await outbox('SEND_TEXT'))
      .map((o) => o.payload as { chatId: string; text: string })
      .find((p) => p.chatId === '1002')!;
    expect(dm.text).toContain('Mijoz Bitrix ham ishlatadi');
  });

  it('status heartbeat and test message', async () => {
    expect((await ctx.http().get('/api/v1/telegram/bot').set(bearer(admin))).body.status.alive).toBe(false);
    await ctx.http().post('/api/v1/internal/bot/status').set(svc()).send({ state: 'CONNECTED' });
    expect((await ctx.http().get('/api/v1/telegram/bot').set(bearer(admin))).body.status).toMatchObject({
      alive: true,
      state: 'CONNECTED',
    });
    expect((await ctx.http().post('/api/v1/telegram/bot/test').set(bearer(admin))).body.ok).toBe(true);
    expect((await outbox('SEND_TEXT'))[0].payload).toMatchObject({ chatId: GROUP_CHAT });
    void BotNotifier;
  });
});
