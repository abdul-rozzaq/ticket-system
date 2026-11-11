import { queryStems } from '@tp/shared';
import { adminToken, bearer, createTestApp, TestCtx } from './helpers';
import { AiService } from '../src/apps/ai/ai.service';
import { CircuitBreaker, LlmError, type LlmAdapter } from '../src/apps/ai/adapters';
import { KbService } from '../src/apps/kb/kb.service';
import { KbGrowthService } from '../src/apps/kb/kb-growth.service';
import { TicketsService } from '../src/apps/tickets/tickets.service';
import fixture from './fixtures/kb.json';

const DIM = 1536;
/** Deterministic stand-in for an embedding model: hashed bag of word stems, L2-normalised (cosine distance ~ lexical overlap). */
const embed = (text: string, dim = DIM) => {
  const v = new Array(dim).fill(0);
  for (const s of queryStems(text)) {
    let h = 7;
    for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % dim] += 1;
  }
  const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / n);
};

describe('knowledge base: CRUD, approval, chunks, search, embeddings, growth (e2e)', () => {
  let ctx: TestCtx;
  let admin: string;
  let staff: { id: string; token: string };
  const embedCalls: Array<{ model: string; input: string[]; dimensions?: number }> = [];
  const completions: Array<{ system: string; user: string; model: string }> = [];
  let embedBehaviour: (input: string[]) => number[][] | Promise<number[][]>;
  let completeBehaviour: () => Promise<{ text: string; inputTokens: number; outputTokens: number }>;

  const ai = () => ctx.app.get(AiService);
  const kb = () => ctx.app.get(KbService);
  const tickets = () => ctx.app.get(TicketsService);
  const search = async (q: string, token = staff.token) =>
    (
      await ctx
        .http()
        .get(`/api/v1/kb/search?q=${encodeURIComponent(q)}`)
        .set(bearer(token))
    ).body;
  const ids = async (q: string) => (await search(q)).hits.map((h: { problem: string }) => h.problem);
  const article = (key: string) => (fixture as Array<Record<string, unknown>>).find((a) => a.key === key)!;
  const create = (a: Record<string, unknown>, status = 'APPROVED') =>
    ctx
      .http()
      .post('/api/v1/kb')
      .set(bearer(admin))
      .send({ ...a, key: undefined, status });
  const seed = async () => {
    const out: Record<string, string> = {};
    for (const a of fixture as Array<Record<string, unknown>>)
      out[a.key as string] = (await create(a)).body.id;
    return out;
  };
  const configureProvider = async (
    type: 'ANTHROPIC' | 'OPENAI_COMPATIBLE',
    models: Record<string, string> = {},
  ) => {
    await ctx
      .http()
      .put('/api/v1/ai/provider')
      .set(bearer(admin))
      .send({
        type,
        name: 'p',
        apiKey: 'sk-test-1234567890',
        ...(type === 'OPENAI_COMPATIBLE' ? { baseUrl: 'https://llm.example/v1' } : {}),
      });
    await ctx.http().put('/api/v1/ai/settings').set(bearer(admin)).send(models);
  };

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await ctx.reset();
    embedCalls.length = 0;
    completions.length = 0;
    embedBehaviour = (input) => input.map((t) => embed(t));
    completeBehaviour = async () => ({ text: '{"skip": true}', inputTokens: 10, outputTokens: 5 });
    const adapter: LlmAdapter = {
      complete: async (r) => {
        completions.push({ system: r.system, user: r.user, model: r.model });
        return completeBehaviour();
      },
      embed: async (r) => {
        embedCalls.push({ model: r.model, input: r.input, dimensions: r.dimensions });
        return { vectors: await embedBehaviour(r.input), tokens: 7 };
      },
    };
    ai().adapterFactory = () => adapter;
    ai().sleep = async () => undefined;
    ai().breaker = new CircuitBreaker(5, 60_000);
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
  });

  describe('CRUD and approval queue', () => {
    it('STAFF is read-only and sees approved articles only; ADMIN manages everything and sees drafts', async () => {
      const ok = await create(article('kb01'));
      const draft = await create(article('kb02'), 'DRAFT');
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({ status: 'APPROVED', lang: 'uz', systemType: 'AMOCRM' });
      expect(draft.body.status).toBe('DRAFT');

      const staffList = await ctx.http().get('/api/v1/kb').set(bearer(staff.token));
      expect(staffList.body.items.map((a: { id: string }) => a.id)).toEqual([ok.body.id]);
      expect((await ctx.http().get('/api/v1/kb?status=DRAFT').set(bearer(staff.token))).body.total).toBe(1); // status filter cannot widen the view: still approved only
      expect(
        (await ctx.http().get('/api/v1/kb?status=DRAFT').set(bearer(staff.token))).body.items[0].status,
      ).toBe('APPROVED');
      expect((await ctx.http().get(`/api/v1/kb/${draft.body.id}`).set(bearer(staff.token))).status).toBe(404);
      expect((await ctx.http().get(`/api/v1/kb/${ok.body.id}`).set(bearer(staff.token))).status).toBe(200);
      for (const r of [
        ctx.http().post('/api/v1/kb').set(bearer(staff.token)).send(article('kb03')),
        ctx.http().patch(`/api/v1/kb/${ok.body.id}`).set(bearer(staff.token)).send({ solution: 'xxxxxxxxx' }),
        ctx.http().post(`/api/v1/kb/${draft.body.id}/approve`).set(bearer(staff.token)),
        ctx.http().get('/api/v1/kb/stats').set(bearer(staff.token)),
        ctx.http().post('/api/v1/kb/reindex').set(bearer(staff.token)),
        ctx.http().delete(`/api/v1/kb/${ok.body.id}`).set(bearer(staff.token)),
      ]) {
        expect((await r).status).toBe(403);
      }
      const adminDrafts = await ctx
        .http()
        .get('/api/v1/kb?status=DRAFT&lang=uz&systemType=AMOCRM')
        .set(bearer(admin));
      expect(adminDrafts.body.items.map((a: { id: string }) => a.id)).toEqual([]); // kb02 is Russian
      expect((await ctx.http().get('/api/v1/kb?status=DRAFT').set(bearer(admin))).body.total).toBe(1);
    });

    it('only APPROVED articles are searchable: draft -> approve -> edit -> reject -> delete', async () => {
      const a = await create(article('kb01'), 'DRAFT');
      expect(await ids('webhook ulanmadi, lidlar tushmayapti')).toEqual([]); // drafts are never used for answers
      expect(
        (await ctx.http().post(`/api/v1/kb/${a.body.id}/approve`).set(bearer(admin))).body,
      ).toMatchObject({ status: 'APPROVED', approvedById: expect.any(String) });
      expect(await ids('webhook ulanmadi, lidlar tushmayapti')).toEqual([article('kb01').problem]);

      // an edit is searchable immediately (chunks are rebuilt)
      await ctx.http().patch(`/api/v1/kb/${a.body.id}`).set(bearer(admin)).send({
        problem: 'Yangi muammo: ulanish webhook xatosi',
        solution: 'Yangi yechim matni shu yerda yoziladi',
      });
      const hit = (await search('webhook ulanish xatosi')).hits[0];
      expect(hit.solution).toBe('Yangi yechim matni shu yerda yoziladi');

      await ctx.http().post(`/api/v1/kb/${a.body.id}/reject`).set(bearer(admin));
      expect(await ids('webhook ulanish xatosi')).toEqual([]);
      expect(await ctx.prisma.kbChunk.count({ where: { articleId: a.body.id } })).toBe(0); // rejected content is not retrievable by any path
      expect((await ctx.http().delete(`/api/v1/kb/${a.body.id}`).set(bearer(admin))).status).toBe(204);
      expect((await ctx.http().get(`/api/v1/kb/${a.body.id}`).set(bearer(admin))).status).toBe(404);
      expect(
        await ctx.prisma.auditLog.count({
          where: { action: { in: ['kb.create', 'kb.update', 'kb.approve', 'kb.reject', 'kb.delete'] } },
        }),
      ).toBe(5);
    });

    it('validates input', async () => {
      expect((await create({ problem: 'x', solution: 'y' })).status).toBe(400);
      expect((await create({ ...article('kb01'), lang: 'de' })).status).toBe(400);
    });

    it('long articles are split into chunks of at most 800 characters', async () => {
      const long = Array.from(
        { length: 60 },
        (_, i) => `Qadam ${i + 1}: sozlamalarni tekshiring va natijani yozib oling.`,
      ).join(' ');
      const a = await create({
        lang: 'uz',
        systemType: 'PBX',
        problem: 'Uzoq yo‘riqnoma bo‘yicha savol',
        solution: long.slice(0, 3900),
      });
      const chunks = await ctx.prisma.kbChunk.findMany({ where: { articleId: a.body.id } });
      expect(chunks.length).toBeGreaterThan(3);
      expect(chunks.every((c) => c.content.length <= 800)).toBe(true);
    });
  });

  describe('full-text search (no AI configured)', () => {
    beforeEach(async () => {
      await seed();
    });

    it('finds the right article for uzbek and russian questions', async () => {
      expect((await ids('webhook ulanmadi, lidlar tushmayapti'))[0]).toBe(article('kb01').problem);
      expect((await ids('SIP telefon registratsiyadan otmayapti'))[0]).toBe(article('kb09').problem);
      expect((await ids('Нет записей звонков в АТС'))[0]).toBe(article('kb10').problem); // russian question -> russian article first
      expect((await ids('qo‘ng‘iroq yozuvlari saqlanmayapti'))[0]).toBe(article('kb11').problem);
      expect((await ids('Вебхук не работает, сделки не приходят'))[0]).toBe(article('kb02').problem);
    });

    it('answers nothing for unrelated questions and for a single common word (relevance guard)', async () => {
      expect(await ids('bugun ob-havo qanday, futbol kim yutdi')).toEqual([]);
      expect(await ids('ishlamayapti')).toEqual([]);
      expect(await ids('')).toEqual([]);
      expect(await ids('   ')).toEqual([]);
    });

    it('is safe against tsquery / SQL syntax in the question', async () => {
      for (const q of [
        '\'); DROP TABLE "KbArticle"; --',
        'webhook & | ! ( ) :* <-> ulanmadi',
        'a:* | b',
        '\\',
        '%%%',
      ]) {
        const r = await ctx
          .http()
          .get(`/api/v1/kb/search?q=${encodeURIComponent(q)}`)
          .set(bearer(staff.token));
        expect(r.status).toBe(200);
      }
      expect(await ctx.prisma.kbArticle.count()).toBe(13);
    });

    it('never returns more than kb.topK hits and reports that no vectors were used', async () => {
      const r = await search('telefon sozlamalari tizim ulanmayapti ishlamayapti');
      expect(r.hits.length).toBeLessThanOrEqual(3);
      expect(r.vectorUsed).toBe(false);
    });
  });

  describe('embeddings (pgvector) with fallback to full-text', () => {
    it('with an OpenAI-compatible embedding model, approved articles get 1536-dim vectors and search fuses both rankings', async () => {
      await configureProvider('OPENAI_COMPATIBLE', { embeddingModel: 'text-embedding-3-small' });
      // the distance threshold depends on the embedding model: this fake gives long articles larger distances
      await ctx.http().put('/api/v1/settings').set(bearer(admin)).send({ 'kb.maxVectorDistance': 0.75 });
      await seed();
      const withVec = await ctx.prisma.$queryRaw<
        Array<{ n: number }>
      >`SELECT COUNT(*)::int AS n FROM "KbChunk" WHERE "embedding" IS NOT NULL`;
      expect(withVec[0].n).toBe(13);
      expect(embedCalls[0]).toMatchObject({ model: 'text-embedding-3-small', dimensions: 1536 }); // asked to shorten to the column size
      const r = await search('webhook ulanmadi, lidlar tushmayapti');
      expect(r.vectorUsed).toBe(true);
      expect(r.hits[0].problem).toBe(article('kb01').problem);
      expect(r.hits[0].via).toBe('both');
      expect(await ctx.prisma.aiUsageLog.count({ where: { task: 'embedding', ok: true } })).toBeGreaterThan(
        13 - 1,
      );
    });

    it('unrelated questions stay unanswered even with vectors (distance threshold)', async () => {
      await configureProvider('OPENAI_COMPATIBLE', { embeddingModel: 'text-embedding-3-small' });
      await ctx.http().put('/api/v1/settings').set(bearer(admin)).send({ 'kb.maxVectorDistance': 0.75 });
      await seed();
      expect((await search('bugun ob-havo qanday, futbol kim yutdi')).hits).toEqual([]);
    });

    it('a model with the wrong dimension: the article is still approved and searchable (no vectors, full-text only)', async () => {
      await configureProvider('OPENAI_COMPATIBLE', { embeddingModel: 'some-768-model' });
      embedBehaviour = (input) => input.map((t) => embed(t, 768));
      const a = await create(article('kb01'));
      expect(a.status).toBe(201);
      expect(
        (
          await ctx.prisma.$queryRaw<
            Array<{ n: number }>
          >`SELECT COUNT(*)::int AS n FROM "KbChunk" WHERE "embedding" IS NOT NULL`
        )[0].n,
      ).toBe(0);
      expect(await ctx.prisma.kbChunk.count()).toBeGreaterThan(0);
      const r = await search('webhook ulanmadi, lidlar tushmayapti');
      expect(r.hits[0].problem).toBe(article('kb01').problem);
      expect(r.vectorUsed).toBe(false);
      expect(r.vectorError).toContain('dimensions');
    });

    it('an Anthropic provider has no embeddings API: no vector calls, no errors, full-text search', async () => {
      await configureProvider('ANTHROPIC', { embeddingModel: 'whatever', draftModel: 'claude-haiku-5-5' });
      await create(article('kb01'));
      expect(embedCalls).toHaveLength(0);
      const r = await search('webhook ulanmadi, lidlar tushmayapti');
      expect(r.hits).toHaveLength(1);
      expect(r.vectorUsed).toBe(false);
      expect(r.vectorError).toBeUndefined();
    });

    it('when embedding the QUESTION fails the search falls back to full-text and says so', async () => {
      await configureProvider('OPENAI_COMPATIBLE', { embeddingModel: 'text-embedding-3-small' });
      await create(article('kb01'));
      embedBehaviour = () => {
        throw new LlmError('503 upstream', 503, false);
      };
      const r = await search('webhook ulanmadi, lidlar tushmayapti');
      expect(r.hits[0].problem).toBe(article('kb01').problem);
      expect(r.vectorUsed).toBe(false);
      expect(r.vectorError).toContain('503');
    });

    it('reindex fills in vectors after an embedding model is configured, and skips articles that already have them', async () => {
      await seed(); // no embedding model yet
      expect(
        (
          await ctx.prisma.$queryRaw<
            Array<{ n: number }>
          >`SELECT COUNT(*)::int AS n FROM "KbChunk" WHERE "embedding" IS NOT NULL`
        )[0].n,
      ).toBe(0);
      await configureProvider('OPENAI_COMPATIBLE', { embeddingModel: 'text-embedding-3-small' });
      const first = await ctx.http().post('/api/v1/kb/reindex').set(bearer(admin));
      expect(first.body).toEqual({ articles: 13, embedded: 13, withoutVectors: 0 });
      const second = await ctx.http().post('/api/v1/kb/reindex').set(bearer(admin));
      expect(second.body.articles).toBe(0);
    });

    it('the monthly budget hard stop also stops embedding calls (search degrades to full-text)', async () => {
      await configureProvider('OPENAI_COMPATIBLE', {
        embeddingModel: 'text-embedding-3-small',
        monthlyBudgetUsd: 1,
      } as never);
      await ctx.prisma.aiUsageLog.create({ data: { task: 'classify', model: 'x', costUsd: 5 } });
      await create(article('kb01'));
      expect(embedCalls).toHaveLength(0);
      expect((await search('webhook ulanmadi, lidlar tushmayapti')).hits).toHaveLength(1);
    });
  });

  describe('knowledge-base growth from closed tickets', () => {
    let groupId: string;
    const grow = () => ctx.app.get(KbGrowthService);
    const closed = async (note: string | undefined, text = 'Webhook ulanmadi, parol: Hunter22secret') => {
      const { ticket } = await tickets().createTicket({ clientGroupId: groupId, text, urgency: 'NORMAL' });
      await tickets().close(ticket.id, staff.id, note);
      return ticket;
    };
    const drafts = () =>
      ctx.prisma.kbArticle.findMany({
        where: { sourceTicketId: { not: null } },
        orderBy: { createdAt: 'asc' },
      });
    const settle = () => new Promise((r) => setTimeout(r, 300));

    beforeEach(async () => {
      const g = await ctx.http().post('/api/v1/client-groups').set(bearer(admin)).send({
        telegramChatId: '-1001234567890',
        title: 'Orient',
        companyName: 'Orient Motors',
        systemType: 'AMOCRM',
      });
      groupId = g.body.id;
    });

    it('closing with a solution note creates a DRAFT article automatically (no AI: extractive, secrets masked), not searchable until approved', async () => {
      const t = await closed('Webhook manzili https qilib o‘zgartirildi, parol: Hunter22secret');
      await settle();
      const [a] = await drafts();
      expect(a).toMatchObject({ status: 'DRAFT', sourceTicketId: t.id, lang: 'uz', systemType: 'AMOCRM' });
      expect(a.tags).toEqual(expect.arrayContaining(['auto', 'extractive']));
      expect(a.solution).not.toContain('Hunter22secret');
      expect(a.solution).toContain('[PAROL]');
      expect(a.problem).not.toContain('Hunter22secret');
      expect(await ids('webhook ulanmadi')).toEqual([]);
      await ctx.http().post(`/api/v1/kb/${a.id}/approve`).set(bearer(admin));
      expect((await ids('webhook ulanmadi')).length).toBe(1);
    });

    it('with an AI provider the model writes the article from masked input; {"skip": true} and bad JSON are handled', async () => {
      await configureProvider('ANTHROPIC', { summaryModel: 'claude-haiku-5-5' });
      completeBehaviour = async () => ({
        text: '```json\n{"problem":"Webhook AmoCRMga ulanmaydi","solution":"Webhook manzili https bo‘lishi kerak","tags":["webhook","https"],"systemType":"AMOCRM","category":"webhook"}\n```',
        inputTokens: 100,
        outputTokens: 40,
      });
      const t = await closed('Webhook manzili https qilib o‘zgartirildi, parol: Hunter22secret');
      await settle();
      const [a] = await drafts();
      expect(a).toMatchObject({
        problem: 'Webhook AmoCRMga ulanmaydi',
        status: 'DRAFT',
        sourceTicketId: t.id,
      });
      expect(a.tags).toEqual(expect.arrayContaining(['auto', 'ai', 'webhook']));
      // the model never saw the secret and got the kb_article prompt
      expect(completions).toHaveLength(1);
      expect(completions[0].user).not.toContain('Hunter22secret');
      expect(completions[0].user).toContain('[PAROL]');
      expect(completions[0].system).toContain('knowledge-base article');
      expect(completions[0].model).toBe('claude-haiku-5-5');

      completeBehaviour = async () => ({ text: '{"skip": true}', inputTokens: 1, outputTokens: 1 });
      await closed('Hal qilindi, hammasi yaxshi ishlayapti endi');
      await settle();
      expect(await drafts()).toHaveLength(1); // vague note: no article

      completeBehaviour = async () => ({ text: 'sorry, I cannot do that', inputTokens: 1, outputTokens: 1 });
      await closed('Telefoniya sozlamalarida ichki raqam biriktirildi');
      await settle();
      const all = await drafts();
      expect(all).toHaveLength(2);
      expect(all[1].tags).toContain('extractive'); // model output unusable -> extractive draft
    });

    it('AI failure (provider down / budget) falls back to the extractive draft instead of losing the knowledge', async () => {
      await configureProvider('ANTHROPIC', { summaryModel: 'claude-haiku-5-5' });
      completeBehaviour = async () => {
        throw new LlmError('500 upstream', 500, false);
      };
      await closed('Webhook manzili https qilib o‘zgartirildi');
      await settle();
      expect((await drafts())[0].tags).toContain('extractive');
    });

    it('skips short notes, merged tickets and duplicates; admins can force an article from a ticket', async () => {
      await closed('ok');
      await closed(undefined);
      await settle();
      expect(await drafts()).toHaveLength(0);

      const t = await closed('Webhook manzili https qilib o‘zgartirildi');
      await settle();
      expect(await drafts()).toHaveLength(1);
      expect(await grow().fromTicket(t.id)).toBeNull(); // one article per ticket
      expect(await drafts()).toHaveLength(1);

      const short = await closed('yaxshi');
      await settle();
      expect(await drafts()).toHaveLength(1);
      const forced = await ctx.http().post(`/api/v1/kb/from-ticket/${short.id}`).set(bearer(admin));
      expect(forced.body.article).toMatchObject({ status: 'DRAFT', sourceTicketId: short.id });
      expect(
        (await ctx.http().post(`/api/v1/kb/from-ticket/${short.id}`).set(bearer(staff.token))).status,
      ).toBe(403);

      const a = (await tickets().createTicket({ clientGroupId: groupId, text: 'birinchi' })).ticket;
      const g2 = await ctx
        .http()
        .post('/api/v1/client-groups')
        .set(bearer(admin))
        .send({ telegramChatId: '-1002222222222', title: 'B', companyName: 'B' });
      const b = (await tickets().createTicket({ clientGroupId: g2.body.id, text: 'ikkinchi' })).ticket;
      await tickets().merge(b.id, a.id, staff.id);
      await settle();
      expect((await drafts()).some((d) => d.sourceTicketId === b.id)).toBe(false); // "Birlashtirildi: #n" is not knowledge
    });

    it('the approval queue lists drafts for admins and stats count them', async () => {
      await closed('Webhook manzili https qilib o‘zgartirildi');
      await settle();
      expect((await ctx.http().get('/api/v1/kb?status=DRAFT').set(bearer(admin))).body.total).toBe(1);
      const stats = (await ctx.http().get('/api/v1/kb/stats').set(bearer(admin))).body;
      expect(stats.articles).toEqual({ DRAFT: 1 });
      expect(stats.drafts.total).toBe(0);
      void kb;
    });
  });
});
