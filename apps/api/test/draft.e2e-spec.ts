import { io, type Socket } from 'socket.io-client';
import { adminToken, bearer, createTestApp, TestCtx } from './helpers';
import { AiService } from '../src/ai/ai.service';
import { CircuitBreaker, LlmError, type LlmAdapter } from '../src/ai/adapters';
import { TicketsService } from '../src/tickets/tickets.service';
import fixture from './fixtures/kb.json';

const CHAT_KEY = 'c:1234567890'; // stored key of "-1001234567890"
const WEB_ID = '-1001234567890';
let msgId = 5000;

describe('AI reply drafts (RAG) (e2e)', () => {
  let ctx: TestCtx;
  let admin: string;
  let ali: { id: string; token: string };
  let vali: { id: string; token: string };
  let groupId: string;
  const requests: Array<{ system: string; user: string; model: string }> = [];
  let completeBehaviour: () => Promise<{ text: string; inputTokens: number; outputTokens: number }>;
  const sockets: Socket[] = [];

  const tickets = () => ctx.app.get(TicketsService);
  const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));
  const draft = (body: object, token = ali.token) =>
    ctx.http().post('/api/v1/ai/draft').set(bearer(token)).send(body);
  const art = (key: string) =>
    (fixture as unknown as Array<Record<string, string>>).find((a) => a.key === key)!;
  const kbIdOf = async (key: string) =>
    (await ctx.prisma.kbArticle.findFirstOrThrow({ where: { problem: art(key).problem } })).id;

  const customer = (text: string, ticketId: string, extra: { id?: bigint; at?: Date } = {}) =>
    tickets().attachMessage(ticketId, CHAT_KEY, {
      direction: 'IN',
      text,
      senderName: 'Jasur',
      telegramMessageId: extra.id ?? BigInt(++msgId),
      sentAt: extra.at,
    });
  const staffReply = (text: string, ticketId: string, answeredById: string | null = ali.id) =>
    tickets().attachMessage(ticketId, CHAT_KEY, {
      direction: 'OUT',
      text,
      telegramMessageId: BigInt(++msgId),
      answeredById,
      answeredConfidence: 0.9,
    });
  const open = async (text: string) =>
    (
      await tickets().createTicket({
        clientGroupId: groupId,
        text,
        senderName: 'Jasur',
        telegramMessageId: BigInt(++msgId),
      })
    ).ticket;
  const configureAi = async () => {
    await ctx
      .http()
      .put('/api/v1/ai/provider')
      .set(bearer(admin))
      .send({ type: 'ANTHROPIC', name: 'p', apiKey: 'sk-test-1234567890' });
    await ctx.http().put('/api/v1/ai/settings').set(bearer(admin)).send({ draftModel: 'claude-sonnet-5-5' });
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.app.listen(0);
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  afterEach(() => {
    sockets.splice(0).forEach((s) => s.disconnect());
  });
  beforeEach(async () => {
    await ctx.reset();
    requests.length = 0;
    completeBehaviour = async () => ({
      text: 'Webhook manzili https bilan boshlanishini tekshiring.',
      inputTokens: 200,
      outputTokens: 30,
    });
    const adapter: LlmAdapter = {
      complete: async (r) => {
        requests.push({ system: r.system, user: r.user, model: r.model });
        return completeBehaviour();
      },
    };
    const ai = ctx.app.get(AiService);
    ai.adapterFactory = () => adapter;
    ai.sleep = async () => undefined;
    ai.breaker = new CircuitBreaker(5, 60_000);
    admin = await adminToken(ctx);
    const mk = async (n: string) => {
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
      return { id: u.body.id as string, token: c.body.accessToken as string };
    };
    ali = await mk('ali');
    vali = await mk('vali');
    const g = await ctx
      .http()
      .post('/api/v1/client-groups')
      .set(bearer(admin))
      .send({ telegramChatId: WEB_ID, title: 'Orient', companyName: 'Orient Motors', systemType: 'AMOCRM' });
    groupId = g.body.id;
    for (const a of fixture as Array<Record<string, unknown>>)
      await ctx
        .http()
        .post('/api/v1/kb')
        .set(bearer(admin))
        .send({ ...a, key: undefined });
  });

  describe('POST /ai/draft', () => {
    it('without an AI provider: composes the draft from the best article (extractive), cites the sources and masks secrets in the preview', async () => {
      const tk = await open('Webhook ulanmadi, lidlar tushmayapti, parol: Hunter22secret');
      const r = await draft({ chatId: WEB_ID });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        notFound: false,
        mode: 'extractive',
        ticketNumber: tk.number,
        chatId: CHAT_KEY,
        maskPolicy: 'ALWAYS',
      });
      expect(r.body.draft).toContain(art('kb01').solution);
      expect(r.body.draft).toContain('Hurmat bilan, Ali.');
      expect(r.body.sources[0]).toMatchObject({
        type: 'article',
        id: await kbIdOf('kb01'),
        title: art('kb01').problem,
      });
      expect(r.body.masked.text).toContain('[PAROL]');
      expect(r.body.masked.text).not.toContain('Hunter22secret');
      expect(r.body.masked.hits).toBe(1);
      expect(requests).toHaveLength(0);
      expect((await ctx.prisma.aiDraft.findUniqueOrThrow({ where: { id: r.body.id } })).userId).toBe(ali.id);
      expect(
        (await ctx.prisma.kbArticle.findUniqueOrThrow({ where: { id: await kbIdOf('kb01') } })).useCount,
      ).toBe(1);
    });

    it('with an AI provider: the model gets ONLY the retrieved articles and masked text, in the draft prompt', async () => {
      await configureAi();
      await open(
        'Webhook ulanmadi, lidlar tushmayapti, parol: Hunter22secret, token sk-ant-api03-abcdefghijklmnopqrstuv',
      );
      const r = await draft({ chatId: WEB_ID });
      expect(r.body).toMatchObject({
        notFound: false,
        mode: 'llm',
        draft: 'Webhook manzili https bilan boshlanishini tekshiring.',
      });
      expect(requests).toHaveLength(1);
      const { system, user, model } = requests[0];
      expect(model).toBe('claude-sonnet-5-5');
      expect(system).toContain('ONLY from the knowledge-base articles'); // the grounding instructions
      expect(system).toContain('NOT_FOUND');
      expect(user).toContain(art('kb01').solution);
      expect(user).toContain(`id="${await kbIdOf('kb01')}"`);
      expect(user).not.toContain(art('kb09').solution); // unrelated articles are not shown to the model
      expect(user).not.toContain(art('kb07').solution);
      expect(user).not.toContain('Hunter22secret');
      expect(user).not.toContain('abcdefghijklmnopqrstuv');
      expect(user).toContain('<customer_question');
      expect(await ctx.prisma.aiUsageLog.count({ where: { task: 'draft', ok: true } })).toBe(1);
    });

    it('NOTHING relevant in the knowledge base: notFound, no invented answer, and the model is never called', async () => {
      await configureAi();
      await open('Bugun ob-havo qanday, kim futbolga boradi?');
      const r = await draft({ chatId: WEB_ID });
      expect(r.body).toMatchObject({ notFound: true, draft: null, sources: [], mode: 'none' });
      expect(requests).toHaveLength(0);
      expect((await ctx.prisma.aiDraft.findUniqueOrThrow({ where: { id: r.body.id } })).notFound).toBe(true);
    });

    it('the model itself answers NOT_FOUND: reported as notFound without sources', async () => {
      await configureAi();
      completeBehaviour = async () => ({ text: 'NOT_FOUND', inputTokens: 100, outputTokens: 2 });
      await open('Webhook ulanmadi, lidlar tushmayapti');
      const r = await draft({ chatId: WEB_ID });
      expect(r.body).toMatchObject({ notFound: true, draft: null, sources: [], mode: 'llm' });
    });

    it('provider failure or exhausted budget: falls back to the article text with a warning', async () => {
      await configureAi();
      completeBehaviour = async () => {
        throw new LlmError('500 upstream', 500, false);
      };
      await open('Webhook ulanmadi, lidlar tushmayapti');
      const r = await draft({ chatId: WEB_ID });
      expect(r.body).toMatchObject({ notFound: false, mode: 'extractive' });
      expect(r.body.warning).toContain('AI ishlamadi');
      expect(r.body.draft).toContain(art('kb01').solution);
    });

    it('a russian customer gets the russian article and a russian composition', async () => {
      await open('Не работает вебхук, сделки не приходят в amoCRM');
      const r = await draft({ chatId: WEB_ID });
      expect(r.body.draft).toContain('По вашему вопросу:');
      expect(r.body.draft).toContain(art('kb02').solution);
      expect(r.body.sources[0].id).toBe(await kbIdOf('kb02'));
    });

    it('context comes from the STORED conversation: only customer messages after the last staff reply, or the selected message', async () => {
      const tk = await open('Salom, savolim bor');
      await staffReply('Salom, eshitaman', tk.id);
      await customer('Webhook ulanmadi, lidlar tushmayapti', tk.id, { id: 9001n });
      await customer('Bitrix24 juda sekin ishlayapti, kesh tozalash kerakmi', tk.id, { id: 9002n });
      const latest = await draft({ chatId: WEB_ID });
      expect(latest.body.masked.text).toContain('Webhook ulanmadi');
      expect(latest.body.masked.text).toContain('Bitrix24 juda sekin');
      expect(latest.body.masked.text).not.toContain('Salom, savolim bor'); // answered earlier

      const picked = await draft({ chatId: WEB_ID, messageId: '9002' });
      expect(picked.body.masked.text).toBe('Bitrix24 juda sekin ishlayapti, kesh tozalash kerakmi');
      expect(
        (await ctx.prisma.aiDraft.findUniqueOrThrow({ where: { id: picked.body.id } })).sourceMessageId,
      ).toBe(9002n);

      const missing = await draft({ chatId: WEB_ID, messageId: '123456' });
      expect(missing.status).toBe(200);
      expect(missing.body.warning).toContain('topilmadi');
      expect(missing.body.masked.text).toContain('Webhook ulanmadi');
    });

    it('internal notes are never part of the conversation sent to the model', async () => {
      await configureAi();
      const tk = await open('Webhook ulanmadi, lidlar tushmayapti');
      await tickets().addNote(tk.id, 'ICHKI-IZOH-MAXFIY mijoz qarzdor', ali.id);
      await draft({ chatId: WEB_ID });
      expect(requests[0].user).not.toContain('ICHKI-IZOH-MAXFIY');
    });

    it('accepts every chat-id format of Telegram Web; unknown chats and chats without a conversation are 404; auth is required', async () => {
      await open('Webhook ulanmadi, lidlar tushmayapti');
      for (const id of [WEB_ID, '-1234567890', CHAT_KEY])
        expect((await draft({ chatId: id })).status).toBe(200);
      expect((await draft({ chatId: '-1009999999999' })).status).toBe(404);
      const g2 = await ctx
        .http()
        .post('/api/v1/client-groups')
        .set(bearer(admin))
        .send({ telegramChatId: '-1002222222222', title: 'B', companyName: 'B' });
      void g2;
      const empty = await draft({ chatId: '-1002222222222' });
      expect(empty.status).toBe(404);
      expect(empty.body.code).toBe('NO_CONVERSATION');
      expect((await ctx.http().post('/api/v1/ai/draft').send({ chatId: WEB_ID })).status).toBe(401);
      expect((await draft({})).status).toBe(400);
    });
  });

  describe('what did the human do with the draft? (quality metric)', () => {
    const outcomeOf = async (id: string) =>
      (await ctx.prisma.aiDraft.findUniqueOrThrow({ where: { id } })).outcome;
    const counters = async () => {
      const a = await ctx.prisma.kbArticle.findFirstOrThrow({ where: { problem: art('kb01').problem } });
      return { unchanged: a.sentUnchanged, edited: a.sentEdited };
    };

    it('sent as-is -> UNCHANGED, lightly edited -> EDITED, unrelated message -> unresolved; counters follow', async () => {
      const tk = await open('Webhook ulanmadi, lidlar tushmayapti');
      const d1 = (await draft({ chatId: WEB_ID })).body;
      await staffReply(`  ${d1.draft.toUpperCase()}  `, tk.id); // only case/spacing differ
      await settle();
      expect(await outcomeOf(d1.id)).toBe('UNCHANGED');
      expect(await counters()).toEqual({ unchanged: 1, edited: 0 });

      const d2 = (await draft({ chatId: WEB_ID })).body;
      await staffReply(
        'Assalomu alaykum! Webhook manzili https bilan boshlanishini va faol ekanini tekshiring, rahmat.',
        tk.id,
      );
      await settle();
      expect(await outcomeOf(d2.id)).toBe('EDITED');
      expect(await counters()).toEqual({ unchanged: 1, edited: 1 });

      const d3 = (await draft({ chatId: WEB_ID })).body;
      await staffReply('Ertaga ofisda uchrashamiz', tk.id);
      await settle();
      expect(await outcomeOf(d3.id)).toBeNull();
      expect(await counters()).toEqual({ unchanged: 1, edited: 1 });
    });

    it('a draft is resolved by ONE message only; old drafts and drafts made for somebody else are ignored', async () => {
      const tk = await open('Webhook ulanmadi, lidlar tushmayapti');
      const d = (await draft({ chatId: WEB_ID })).body;
      await staffReply(d.draft, tk.id);
      await staffReply(d.draft, tk.id);
      await settle();
      expect(await counters()).toEqual({ unchanged: 1, edited: 0 });

      const forVali = (await draft({ chatId: WEB_ID }, vali.token)).body;
      await staffReply(forVali.draft, tk.id, ali.id); // Ali sends Vali's draft: not attributed to it
      await settle();
      expect(await outcomeOf(forVali.id)).toBeNull();
      await staffReply(forVali.draft, tk.id, vali.id);
      await settle();
      expect(await outcomeOf(forVali.id)).toBe('UNCHANGED');

      const old = (await draft({ chatId: WEB_ID })).body;
      await ctx.prisma.aiDraft.update({
        where: { id: old.id },
        data: { createdAt: new Date(Date.now() - 45 * 60_000) },
      });
      await staffReply(old.draft, tk.id);
      await settle();
      expect(await outcomeOf(old.id)).toBeNull(); // too old to attribute
    });

    it('notFound drafts and internal notes are never counted; discard endpoint records DISCARDED', async () => {
      const tk = await open('Webhook ulanmadi, lidlar tushmayapti');
      const d = (await draft({ chatId: WEB_ID })).body;
      await tickets().addNote(tk.id, d.draft, ali.id); // pasting the draft into a note is not "sending"
      await settle();
      expect(await outcomeOf(d.id)).toBeNull();
      expect((await ctx.http().post(`/api/v1/ai/drafts/${d.id}/discard`).set(bearer(ali.token))).status).toBe(
        204,
      );
      expect(await outcomeOf(d.id)).toBe('DISCARDED');
      expect((await ctx.http().post(`/api/v1/ai/drafts/${d.id}/discard`).set(bearer(ali.token))).status).toBe(
        204,
      ); // idempotent
      expect(
        (
          await ctx
            .http()
            .post('/api/v1/ai/drafts/00000000-0000-0000-0000-000000000000/discard')
            .set(bearer(ali.token))
        ).status,
      ).toBe(404);
    });

    it('stats: hit rate, notFound, extractive/llm split, unchanged rate, top articles', async () => {
      const tk = await open('Webhook ulanmadi, lidlar tushmayapti');
      const d = (await draft({ chatId: WEB_ID })).body;
      await staffReply(d.draft, tk.id);
      await settle();
      const tk2 = await open('Bugun ob-havo qanday, kim futbolga boradi?'); // attaches to the open ticket
      void tk2;
      await customer('Bugun ob-havo qanday, futbol kim yutdi?', tk.id);
      await draft({ chatId: WEB_ID, messageId: String(msgId) });
      const s = (await ctx.http().get('/api/v1/kb/stats').set(bearer(admin))).body;
      expect(s.drafts).toMatchObject({
        total: 2,
        notFound: 1,
        extractive: 1,
        sentUnchanged: 1,
        unchangedRate: 1,
      });
      expect(s.drafts.hitRate).toBeCloseTo(0.5);
      expect(s.topArticles[0]).toMatchObject({ problem: art('kb01').problem, useCount: 1, sentUnchanged: 1 });
    });
  });

  describe('".ai" typed by staff in the customer chat -> draft over the WebSocket', () => {
    const connect = (token: string) =>
      new Promise<Socket>((resolve, reject) => {
        const port = (ctx.app.getHttpServer().address() as { port: number }).port;
        const s = io(`http://127.0.0.1:${port}/events`, {
          auth: { token },
          transports: ['websocket'],
          reconnection: false,
        });
        sockets.push(s);
        s.on('connect', () => resolve(s));
        s.on('connect_error', reject);
      });
    const nextDraft = (s: Socket, ms = 4000) =>
      new Promise<Record<string, unknown> | null>((resolve) => {
        const t = setTimeout(() => resolve(null), ms);
        s.once('draft.ready', (p) => {
          clearTimeout(t);
          resolve(p);
        });
      });
    const sendAi = () =>
      ctx
        .http()
        .post('/api/v1/internal/userbot/messages')
        .set(ctx.svc())
        .send({
          chatId: CHAT_KEY,
          messageId: String(++msgId),
          senderId: '1',
          senderName: 'TP',
          text: '.ai',
          outgoing: true,
          replyToMessageId: null,
          date: new Date().toISOString(),
          hasMedia: false,
        });

    it('the draft is delivered ONLY to the attributed staff member (the person who pinged from the extension)', async () => {
      await open('Webhook ulanmadi, lidlar tushmayapti');
      const [sAli, sVali] = [await connect(ali.token), await connect(vali.token)];
      const gotAli = nextDraft(sAli);
      const gotVali = nextDraft(sVali, 1500);
      await ctx.http().post('/api/v1/activity').set(bearer(ali.token)).send({ chatId: WEB_ID }); // Ali presses "send" in this chat
      expect((await sendAi()).body).toMatchObject({ action: 'command', command: 'ai' });
      const d = (await gotAli) as {
        draft: string;
        notFound: boolean;
        sources: unknown[];
        ticketNumber: number;
        id: string;
      };
      expect(d).toBeTruthy();
      expect(d.notFound).toBe(false);
      expect(d.draft).toContain(art('kb01').solution);
      expect(d.sources.length).toBeGreaterThan(0);
      expect(await gotVali).toBeNull(); // Vali does not receive Ali's draft
      expect((await ctx.prisma.aiDraft.findUniqueOrThrow({ where: { id: d.id } })).userId).toBe(ali.id);
      // the command message itself is queued for deletion from the customer chat
      expect(await ctx.prisma.userbotCommand.count({ where: { type: 'DELETE_MESSAGES' } })).toBe(1);
    });

    it('when nobody can be attributed the draft goes to all staff sockets; unauthenticated sockets get nothing', async () => {
      await open('Webhook ulanmadi, lidlar tushmayapti');
      const [sAli, sVali] = [await connect(ali.token), await connect(vali.token)];
      const [a, v] = [nextDraft(sAli), nextDraft(sVali)];
      await sendAi();
      expect(await a).toBeTruthy();
      expect(await v).toBeTruthy();
      await expect(connect('garbage-token')).resolves.toBeDefined(); // the handshake is accepted, then the server drops the socket
      const bad = sockets[sockets.length - 1];
      await new Promise((r) => setTimeout(r, 400));
      expect(bad.connected).toBe(false);
    });

    it('"not found" drafts are delivered too (so the extension can say "Bazada topilmadi")', async () => {
      await open('Bugun ob-havo qanday, kim futbolga boradi?');
      const s = await connect(ali.token);
      await ctx.http().post('/api/v1/activity').set(bearer(ali.token)).send({ chatId: WEB_ID });
      const got = nextDraft(s);
      await sendAi();
      expect(await got).toMatchObject({ notFound: true, draft: null });
    });
  });
});
