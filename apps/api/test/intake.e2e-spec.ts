import type { AiClassification } from '@tp/shared';
import { adminToken, bearer, createTestApp, TestCtx } from './helpers';
import { IntakeService } from '../src/intake/intake.service';
import { DomainEvents } from '../src/events/domain-events';

/** Scriptable stand-in for the AI classifier (the real AiService is covered in ai.e2e-spec.ts). */
const fake = {
  calls: [] as Array<{ text: string; context: string[] }>,
  impl: async (): Promise<AiClassification> => ({
    isRequest: true, confidence: 0.92, systemType: 'AMOCRM', category: 'webhook', urgency: 'NORMAL', language: 'uz', summary: 'Webhook ishlamayapti',
  }),
  async classify(text: string, context: string[]) {
    this.calls.push({ text, context });
    return this.impl();
  },
};

const CHAT = 'c:1234567890';
let msgId = 1000;
const msg = (o: Partial<Record<string, unknown>> = {}) => ({
  chatId: CHAT, messageId: String(++msgId), senderId: '555', senderName: 'Jasur', text: 'Webhook ulanmadi, lidlar tushmayapti',
  outgoing: false, replyToMessageId: null, date: new Date().toISOString(), hasMedia: false, ...o,
});

describe('intake pipeline (e2e)', () => {
  let ctx: TestCtx;
  let admin: string;
  let groupId: string;
  let staff: Array<{ id: string; token: string }>;

  const post = (ev: object) => ctx.http().post('/api/v1/internal/userbot/messages').set(ctx.svc()).send(ev);
  const intake = () => ctx.app.get(IntakeService);
  const flush = () => intake().processDue(new Date(Date.now() + 60_000));
  const tickets = () => ctx.prisma.ticket.findMany({ orderBy: { openedAt: 'asc' } });
  const ping = (token: string) => ctx.http().post('/api/v1/activity').set(bearer(token)).send({ chatId: '-1001234567890' });
  const waitFor = async <T>(fn: () => Promise<T | null | undefined | false>, ms = 3000): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v) return v as T;
      if (Date.now() > end) throw new Error('waitFor timed out');
      await new Promise((r) => setTimeout(r, 50));
    }
  };

  beforeAll(async () => {
    ctx = await createTestApp({ classifier: fake });
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await ctx.reset();
    fake.calls = [];
    fake.impl = async () => ({ isRequest: true, confidence: 0.92, systemType: 'AMOCRM', category: 'webhook', urgency: 'NORMAL', language: 'uz', summary: 'Webhook ishlamayapti' });
    admin = await adminToken(ctx);
    staff = [];
    for (const n of ['ali', 'vali']) {
      const u = await ctx.http().post('/api/v1/users').set(bearer(admin)).send({ username: n, displayName: n, password: 'Temp-password-1' });
      const l = await ctx.login(n, 'Temp-password-1');
      const c = await ctx.http().post('/api/v1/auth/change-password').set(bearer(l.accessToken)).send({ currentPassword: 'Temp-password-1', newPassword: 'Staff-new-pass-1' });
      staff.push({ id: u.body.id, token: c.body.accessToken });
    }
    const g = await ctx.http().post('/api/v1/client-groups').set(bearer(admin)).send({ telegramChatId: '-1001234567890', title: 'Orient Motors', companyName: 'Orient Motors', systemType: 'AMOCRM' });
    groupId = g.body.id;
  });

  it('requires the service token', async () => {
    expect((await ctx.http().post('/api/v1/internal/userbot/messages').send(msg())).status).toBe(401);
    expect((await ctx.http().post('/api/v1/internal/userbot/messages').set('x-service-token', 'wrong').send(msg())).status).toBe(401);
    expect((await ctx.http().post('/api/v1/internal/userbot/messages').set(bearer(admin)).send(msg())).status).toBe(401); // a user JWT is not a service token
    expect((await post({ chatId: 'bad' })).status).toBe(400);
  });

  it('ignores unknown and inactive groups', async () => {
    expect((await post(msg({ chatId: 'c:999' }))).body).toMatchObject({ action: 'ignored' });
    await ctx.http().patch(`/api/v1/client-groups/${groupId}`).set(bearer(admin)).send({ isActive: false });
    expect((await post(msg())).body).toMatchObject({ action: 'ignored', why: 'group inactive' });
    expect(fake.calls).toHaveLength(0);
  });

  it('rules pre-filter: noise never reaches the AI and is recorded once (redelivery-safe)', async () => {
    const thanks = msg({ text: 'Rahmat!' });
    expect((await post(msg({ text: '👍' }))).body).toMatchObject({ action: 'filtered', reason: 'EMOJI_ONLY' });
    expect((await post(thanks)).body).toMatchObject({ action: 'filtered', reason: 'ACKNOWLEDGEMENT' });
    expect((await post(thanks)).body).toMatchObject({ action: 'filtered' }); // same message delivered twice
    expect((await post(msg({ text: 'ok' }))).body.reason).toBe('ACKNOWLEDGEMENT');
    expect(await ctx.prisma.filteredMessage.count()).toBe(3);
    expect(fake.calls).toHaveLength(0);
    expect(await tickets()).toHaveLength(0);
  });

  it('debounce: several messages in a row become ONE ticket after the window, with masked text sent to AI', async () => {
    expect((await post(msg({ text: 'Salom, AmoCRMda muammo bor' }))).body.action).toBe('buffered');
    await post(msg({ text: 'login admin, parol: Qwerty123 bilan kirolmayapman' }));
    await post(msg({ text: 'tel +998 90 123 45 67 ga qo\'ng\'iroq qiling' }));
    expect(await intake().processDue(new Date())).toBe(0); // inside the window: nothing happens
    expect(await tickets()).toHaveLength(0);

    expect(await flush()).toBe(1);
    const [t] = await tickets();
    expect(await tickets()).toHaveLength(1);
    expect(t).toMatchObject({ status: 'NEW', systemType: 'AMOCRM', category: 'webhook', summary: 'Webhook ishlamayapti', needsReview: false });
    expect(t.aiConfidence).toBeCloseTo(0.92);
    expect(await ctx.prisma.ticketMessage.count({ where: { ticketId: t.id } })).toBe(3);

    // secrets were masked BEFORE the AI saw the text
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].text).toContain('[PAROL]');
    expect(fake.calls[0].text).toContain('[TELEFON]');
    expect(fake.calls[0].text).not.toContain('Qwerty123');
    expect(fake.calls[0].text).not.toContain('123 45 67');
    // the ticket itself keeps the original text for the staff
    const stored = await ctx.prisma.ticketMessage.findMany({ where: { ticketId: t.id } });
    expect(stored.some((m) => m.text.includes('Qwerty123'))).toBe(true);
  });

  it('AI says "not a request": stored as filtered with the verdict, then one click creates the ticket', async () => {
    fake.impl = async () => ({ isRequest: false, confidence: 0.95, systemType: 'OTHER', category: 'chat', urgency: 'LOW', language: 'uz', summary: 'mijozlar o\'rtasida suhbat' });
    await post(msg({ text: 'Bugun ob-havo juda yaxshi ekan, kim futbolga boradi?' }));
    await flush();
    expect(await tickets()).toHaveLength(0);
    const f = await ctx.http().get('/api/v1/filtered-messages').set(bearer(staff[0].token));
    expect(f.body.total).toBe(1);
    expect(f.body.items[0]).toMatchObject({ reason: 'AI_NOT_REQUEST' });
    expect(f.body.items[0].aiVerdict.isRequest).toBe(false);

    const created = await ctx.http().post(`/api/v1/filtered-messages/${f.body.items[0].id}/create-ticket`).set(bearer(staff[0].token));
    expect(created.status).toBe(200);
    const t = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: created.body.ticketId } });
    expect(t.createdFromFilteredId).toBe(f.body.items[0].id);
    expect((await ctx.http().get('/api/v1/filtered-messages').set(bearer(staff[0].token))).body.total).toBe(0); // no longer pending review
  });

  it('FAIL-OPEN: low confidence or any AI failure opens the ticket flagged needsReview', async () => {
    fake.impl = async () => ({ isRequest: false, confidence: 0.3, systemType: 'OTHER', category: 'other', urgency: 'NORMAL', language: 'uz', summary: '' });
    await post(msg({ text: 'Menimcha nimadir ishlamayapti shekilli' }));
    await flush();
    let [t] = await tickets();
    expect(t).toMatchObject({ needsReview: true });
    await ctx.http().post(`/api/v1/tickets/${t.id}/close`).set(bearer(staff[0].token)).send({});

    fake.impl = async () => {
      throw new Error('AI provider timeout');
    };
    await post(msg({ text: 'Yana bir muammo: telefoniya ulanmayapti' }));
    await flush();
    t = (await tickets())[1];
    expect(t).toMatchObject({ needsReview: true, aiConfidence: null, status: 'NEW' });
    const ev = await ctx.prisma.ticketEvent.findFirstOrThrow({ where: { ticketId: t.id, type: 'AI_CLASSIFIED' } });
    expect(JSON.stringify(ev.payload)).toContain('AI provider timeout');
  });

  it('urgent keywords skip the debounce and force HIGH urgency', async () => {
    const r = await post(msg({ text: "Hamma narsa to'xtab qoldi, srochno yordam kerak!" }));
    expect(r.body.action).toBe('processed');
    const [t] = await tickets();
    expect(t).toMatchObject({ urgency: 'HIGH', status: 'NEW' });
  });

  it('messages inside an open ticket attach without calling the AI again', async () => {
    await post(msg({ text: 'Webhook ulanmadi, lidlar tushmayapti' }));
    await flush();
    const calls = fake.calls.length;
    const r = await post(msg({ text: 'Skrinshot yubordim, qarab ko\'ring' }));
    expect(r.body.action).toBe('attached');
    expect(fake.calls).toHaveLength(calls);
    expect(await ctx.prisma.ticketMessage.count()).toBe(2);
  });

  it('outgoing messages stamp the first response and are attributed to the staff member who pinged', async () => {
    await post(msg());
    await flush();
    await ping(staff[0].token);
    const r = await post(msg({ outgoing: true, senderId: '1', senderName: 'TP', text: "Ko'rib chiqamiz" }));
    expect(r.body.action).toBe('outgoing');
    const [t] = await tickets();
    expect(t.firstResponseAt).not.toBeNull();
    const out = await ctx.prisma.ticketMessage.findFirstOrThrow({ where: { direction: 'OUT' } });
    expect(out).toMatchObject({ answeredById: staff[0].id, answeredConfidence: 0.9 });
  });

  it('attribution confidence drops when several people pinged the same chat, and is null with no ping', async () => {
    await post(msg());
    await flush();
    await ping(staff[0].token);
    await ping(staff[1].token);
    await post(msg({ outgoing: true, text: 'Bir daqiqa' }));
    expect((await ctx.prisma.ticketMessage.findFirstOrThrow({ where: { direction: 'OUT' } })).answeredConfidence).toBe(0.5);

    await ctx.prisma.staffActivity.deleteMany();
    await post(msg({ outgoing: true, text: 'Yana bitta xabar' }));
    const last = await ctx.prisma.ticketMessage.findFirstOrThrow({ where: { direction: 'OUT', text: 'Yana bitta xabar' } });
    expect(last.answeredById).toBeNull();
  });

  it('activity pings can be switched off in settings', async () => {
    await ctx.http().put('/api/v1/settings').set(bearer(admin)).send({ 'activity.pingEnabled': false });
    await ping(staff[0].token);
    expect(await ctx.prisma.staffActivity.count()).toBe(0);
  });

  describe('staff commands', () => {
    beforeEach(async () => {
      await post(msg());
      await flush();
    });
    const outgoing = (text: string, extra: object = {}) => post(msg({ outgoing: true, senderId: '1', text, ...extra }));

    it('.done closes with the solution note, attributes the actor, and queues deletion of the command message', async () => {
      await ping(staff[1].token);
      const r = await outgoing('.done token yangilandi');
      expect(r.body).toMatchObject({ action: 'command', command: 'done' });
      const [t] = await tickets();
      expect(t).toMatchObject({ status: 'CLOSED', solutionNote: 'token yangilandi', closedById: staff[1].id });
      const del = await ctx.prisma.userbotCommand.findFirstOrThrow({ where: { type: 'DELETE_MESSAGES' } });
      expect(del.payload).toMatchObject({ chatId: CHAT, messageIds: [expect.any(String)] });
    });

    it('does not delete the command message when the setting is off', async () => {
      await ctx.http().put('/api/v1/settings').set(bearer(admin)).send({ 'commands.deleteAfterUse': false });
      await outgoing('#done');
      expect(await ctx.prisma.userbotCommand.count()).toBe(0);
    });

    it('.wait and .note', async () => {
      await outgoing('.wait');
      expect((await tickets())[0].status).toBe('WAITING_CLIENT');
      await outgoing('.note mijoz ertaga qayta yozadi');
      const notes = await ctx.prisma.ticketMessage.findMany({ where: { isInternalNote: true } });
      expect(notes.map((n) => n.text)).toEqual(['mijoz ertaga qayta yozadi']);
      // a note never counts as a response
      expect((await tickets())[0].firstResponseAt).toBeNull();
    });

    it('.done sent as a reply closes the ticket of the replied-to message, not the open one', async () => {
      const [old] = await tickets();
      const first = await ctx.prisma.ticketMessage.findFirstOrThrow({ where: { ticketId: old.id } });
      await ctx.http().post(`/api/v1/tickets/${old.id}/close`).set(bearer(staff[0].token)).send({});
      await post(msg({ text: 'Yangi muammo: Bitrix24 sekin ishlayapti' }));
      await flush();
      const open = (await tickets()).find((t) => t.status !== 'CLOSED')!;

      const r = await outgoing('.done eski masala', { replyToMessageId: first.telegramMessageId!.toString() });
      expect(r.body.ticketId).toBe(old.id);
      expect((await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: open.id } })).status).not.toBe('CLOSED');
    });

    it('.ai emits an event for the AI draft flow', async () => {
      const seen: unknown[] = [];
      ctx.app.get(DomainEvents).on('ai.requested', (p) => seen.push(p));
      await outgoing('.ai');
      expect(seen).toHaveLength(1);
    });

    it('a command with no ticket is harmless', async () => {
      await outgoing('.done');
      const r = await outgoing('.done');
      expect(r.body).toMatchObject({ action: 'command' });
    });
  });

  it('reactions: ✅ closes, 👀 counts as first response, others\' reactions are ignored', async () => {
    await post(msg());
    await flush();
    const react = (emoji: string, byMe = true) =>
      ctx.http().post('/api/v1/internal/userbot/reactions').set(ctx.svc()).send({ chatId: CHAT, messageId: '1001', emoji, byMe });
    expect((await react('✅', false)).body.action).toBe('ignored');
    expect((await react('👀')).body.action).toBe('seen');
    expect((await tickets())[0].firstResponseAt).not.toBeNull();
    expect((await react('👀')).body.action).toBe('ignored'); // already responded
    expect((await react('✅')).body.action).toBe('closed');
    expect((await tickets())[0].status).toBe('CLOSED');
  });

  it('auto-assignment: LEAST_LOADED global default, FIXED_OWNER per-group override', async () => {
    // ali already has one open ticket in another group -> vali is less loaded
    const g2 = await ctx.http().post('/api/v1/client-groups').set(bearer(admin)).send({ telegramChatId: '-1007777777777', title: 'B', companyName: 'B' });
    const other = await ctx.http().post('/api/v1/tickets').set(bearer(admin)).send({ clientGroupId: g2.body.id, text: 'boshqa muammo' });
    await ctx.http().post(`/api/v1/tickets/${other.body.ticket.id}/take`).set(bearer(staff[0].token));

    // the admin account is also a candidate; make it unavailable so the outcome is deterministic
    const me = (await ctx.http().get('/api/v1/auth/me').set(bearer(admin))).body;
    await ctx.http().patch(`/api/v1/users/${me.id}`).set(bearer(admin)).send({ available: false });
    await ctx.http().put('/api/v1/settings').set(bearer(admin)).send({ 'assignment.strategy': 'LEAST_LOADED' });
    await post(msg());
    await flush();
    const t = await waitFor(async () => (await ctx.prisma.ticket.findFirst({ where: { clientGroupId: groupId } }))?.assigneeId);
    expect(t).toBe(staff[1].id);

    await ctx.http().post(`/api/v1/tickets/${(await ctx.prisma.ticket.findFirstOrThrow({ where: { clientGroupId: groupId } })).id}/close`).set(bearer(admin)).send({});
    await ctx.http().patch(`/api/v1/client-groups/${groupId}`).set(bearer(admin)).send({ assignmentStrategy: 'FIXED_OWNER', defaultOwnerId: staff[0].id });
    await post(msg({ text: 'Yana muammo bor, tekshirib bering' }));
    await flush();
    const t2 = await waitFor(async () => (await ctx.prisma.ticket.findMany({ where: { clientGroupId: groupId, status: { not: 'CLOSED' } } }))[0]?.assigneeId);
    expect(t2).toBe(staff[0].id);
  });

  it('discovery imports unconfirmed, inactive groups once', async () => {
    const send = () =>
      ctx.http().post('/api/v1/internal/userbot/dialogs').set(ctx.svc()).send({ items: [{ chatId: 'c:42424242', title: 'Yangi guruh' }, { chatId: 'c:1234567890', title: 'Orient Motors' }] });
    expect((await send()).body).toEqual({ created: 1 });
    expect((await send()).body).toEqual({ created: 0 });
    const g = await ctx.prisma.clientGroup.findFirstOrThrow({ where: { telegramChatId: 'c:42424242' } });
    expect(g).toMatchObject({ isActive: false, isConfirmed: false });
    expect((await post(msg({ chatId: 'c:42424242' }))).body.action).toBe('ignored'); // until an admin activates it
  });

  describe('userbot login + command outbox', () => {
    const claim = (wait = 0) => ctx.http().get(`/api/v1/internal/userbot/commands?wait=${wait}`).set(ctx.svc());
    const result = (id: string, body: object) => ctx.http().post(`/api/v1/internal/userbot/commands/${id}/result`).set(ctx.svc()).send(body);
    const status = async () => (await ctx.http().get('/api/v1/telegram/userbot/status').set(bearer(admin))).body;

    it('is admin only', async () => {
      expect((await ctx.http().get('/api/v1/telegram/userbot/status').set(bearer(staff[0].token))).status).toBe(403);
    });

    it('phone -> code -> 2FA password -> session stored encrypted; secrets never rest in the DB', async () => {
      expect((await status()).status).toBe('LOGGED_OUT');
      await ctx.http().post('/api/v1/telegram/userbot/login/phone').set(bearer(admin)).send({ phone: '+998901234567' });
      expect((await status()).status).toBe('CODE_REQUESTED');

      const c1 = (await claim()).body;
      expect(c1).toHaveLength(1);
      expect(c1[0]).toMatchObject({ type: 'LOGIN_SEND_CODE', payload: { phone: '+998901234567' } });
      expect((await claim()).body).toHaveLength(0); // handed out once
      await result(c1[0].id, { ok: true });
      expect((await status()).status).toBe('CODE_SENT');

      await ctx.http().post('/api/v1/telegram/userbot/login/code').set(bearer(admin)).send({ code: '12345' });
      const c2 = (await claim()).body;
      expect(c2[0].payload).toEqual({ code: '12345' });
      const rowAfterClaim = await ctx.prisma.userbotCommand.findUniqueOrThrow({ where: { id: c2[0].id } });
      expect(JSON.stringify(rowAfterClaim.payload)).not.toContain('12345'); // wiped on claim
      await result(c2[0].id, { ok: true, result: { needPassword: true } });
      expect((await status()).status).toBe('NEED_PASSWORD');

      await ctx.http().post('/api/v1/telegram/userbot/login/password').set(bearer(admin)).send({ password: 'my-2fa-secret' });
      const c3 = (await claim()).body;
      expect(JSON.stringify((await ctx.prisma.userbotCommand.findUniqueOrThrow({ where: { id: c3[0].id } })).payload)).not.toContain('my-2fa-secret');
      await result(c3[0].id, { ok: true, result: { session: 'SESSION-STRING-XYZ', phone: '+998901234567' } });

      const s = await status();
      expect(s).toMatchObject({ status: 'CONNECTED', hasSession: true, phone: '+998901234567' });
      expect(JSON.stringify(s)).not.toContain('SESSION-STRING-XYZ');
      const row = await ctx.prisma.userbotSession.findFirstOrThrow();
      expect(row.sessionEnc).toBeTruthy();
      expect(row.sessionEnc).not.toContain('SESSION-STRING-XYZ');
      expect(JSON.stringify((await ctx.prisma.userbotCommand.findUniqueOrThrow({ where: { id: c3[0].id } })).result)).not.toContain('SESSION-STRING-XYZ');
      expect((await ctx.http().get('/api/v1/internal/userbot/session').set(ctx.svc())).body).toEqual({ session: 'SESSION-STRING-XYZ' });
      expect((await ctx.http().get('/api/v1/internal/userbot/session')).status).toBe(401);
    });

    it('failed login is reported and logout clears the session', async () => {
      await ctx.http().post('/api/v1/telegram/userbot/login/phone').set(bearer(admin)).send({ phone: '+998901234567' });
      const c = (await claim()).body;
      await result(c[0].id, { ok: false, error: 'PHONE_NUMBER_INVALID' });
      expect(await status()).toMatchObject({ status: 'LOGIN_FAILED' });

      await ctx.prisma.userbotSession.updateMany({ data: { status: 'CONNECTED', sessionEnc: 'x' } });
      await ctx.http().post('/api/v1/telegram/userbot/logout').set(bearer(admin));
      const l = (await claim()).body;
      await result(l[0].id, { ok: true });
      expect(await status()).toMatchObject({ status: 'LOGGED_OUT', hasSession: false });
    });

    it('heartbeats mark the userbot alive; long-poll returns commands enqueued while waiting', async () => {
      expect((await status()).alive).toBe(false);
      await ctx.http().post('/api/v1/internal/userbot/status').set(ctx.svc()).send({ state: 'CONNECTED', me: { username: 'tp_account' } });
      expect(await status()).toMatchObject({ alive: true, status: 'CONNECTED' });

      const polling = claim(5);
      await new Promise((r) => setTimeout(r, 300));
      await ctx.http().post('/api/v1/telegram/userbot/discover').set(bearer(admin));
      const r = await polling;
      expect(r.body.map((c: { type: string }) => c.type)).toEqual(['DISCOVER_DIALOGS']);
    });

    it('two concurrent pollers never receive the same command', async () => {
      for (let i = 0; i < 6; i++) await ctx.http().post('/api/v1/telegram/userbot/discover').set(bearer(admin));
      const [a, b] = await Promise.all([claim(), claim()]);
      const ids = [...a.body, ...b.body].map((c: { id: string }) => c.id);
      expect(ids).toHaveLength(6);
      expect(new Set(ids).size).toBe(6);
    });
  });
});
