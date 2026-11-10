import { adminToken, bearer, createTestApp, TestCtx } from './helpers';
import { AiService } from '../src/ai/ai.service';
import { IntakeService } from '../src/intake/intake.service';
import { CircuitBreaker, LlmError, type LlmAdapter, type LlmRequest } from '../src/ai/adapters';

const VERDICT = { isRequest: true, confidence: 0.9, systemType: 'BITRIX24', category: 'telephony', urgency: 'NORMAL', language: 'uz', summary: 'Telefoniya ishlamayapti' };

describe('AI settings + real AiService (e2e)', () => {
  let ctx: TestCtx;
  let admin: string;
  let staffToken: string;
  const requests: LlmRequest[] = [];
  let behaviour: (r: LlmRequest) => Promise<{ text: string; inputTokens: number; outputTokens: number }>;
  let factoryCalls: Array<{ type: string; apiKey: string; baseUrl: string | null }> = [];

  const ai = () => ctx.app.get(AiService);
  const configure = async () => {
    await ctx.http().put('/api/v1/ai/provider').set(bearer(admin)).send({ type: 'ANTHROPIC', name: 'main', apiKey: 'sk-ant-test-1234567890' });
    await ctx.http().put('/api/v1/ai/settings').set(bearer(admin)).send({ classifyModel: 'claude-haiku-5-5', draftModel: 'claude-sonnet-5-5', monthlyBudgetUsd: 10 });
  };

  beforeAll(async () => {
    ctx = await createTestApp(); // the REAL classifier (AiService) is wired in
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await ctx.reset();
    requests.length = 0;
    factoryCalls = [];
    behaviour = async () => ({ text: JSON.stringify(VERDICT), inputTokens: 1000, outputTokens: 100 });
    const adapter: LlmAdapter = { complete: async (r) => { requests.push(r); return behaviour(r); } };
    ai().adapterFactory = (type, apiKey, baseUrl) => { factoryCalls.push({ type, apiKey, baseUrl }); return adapter; };
    ai().sleep = async () => undefined; // no real backoff in tests
    ai().breaker = new CircuitBreaker(5, 60_000);
    admin = await adminToken(ctx);
    const u = await ctx.http().post('/api/v1/users').set(bearer(admin)).send({ username: 'ali', displayName: 'Ali', password: 'Temp-password-1' });
    const l = await ctx.login('ali', 'Temp-password-1');
    staffToken = (await ctx.http().post('/api/v1/auth/change-password').set(bearer(l.accessToken)).send({ currentPassword: 'Temp-password-1', newPassword: 'Staff-new-pass-1' })).body.accessToken;
    void u;
  });

  it('is admin only', async () => {
    expect((await ctx.http().get('/api/v1/ai/settings').set(bearer(staffToken))).status).toBe(403);
    expect((await ctx.http().put('/api/v1/ai/provider').set(bearer(staffToken)).send({ type: 'ANTHROPIC', apiKey: 'sk-ant-xxxxxxxx' })).status).toBe(403);
  });

  it('stores the API key encrypted and never returns it (only a 4-char hint)', async () => {
    expect((await ctx.http().put('/api/v1/ai/provider').set(bearer(admin)).send({ type: 'ANTHROPIC' })).status).toBe(400); // key required on first save
    const r = await ctx.http().put('/api/v1/ai/provider').set(bearer(admin)).send({ type: 'ANTHROPIC', name: 'main', apiKey: 'sk-ant-test-1234567890' });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain('sk-ant-test');
    expect(r.body.provider).toMatchObject({ type: 'ANTHROPIC', hasKey: true, keyHint: '••••7890' });
    const row = await ctx.prisma.aiProvider.findFirstOrThrow();
    expect(row.apiKeyEnc.startsWith('v1.')).toBe(true);
    expect(row.apiKeyEnc).not.toContain('sk-ant');

    // updating without a key keeps the stored one
    await ctx.http().put('/api/v1/ai/provider').set(bearer(admin)).send({ type: 'OPENAI_COMPATIBLE', name: 'proxy', baseUrl: 'https://llm.example/v1' });
    await configure();
    await ai().complete({ task: 'classify', user: 'x' });
    expect(factoryCalls.at(-1)).toMatchObject({ apiKey: 'sk-ant-test-1234567890' });
  });

  it('prompts: defaults are served, overrides apply to calls, reset restores the default', async () => {
    await configure();
    const before = await ctx.http().get('/api/v1/ai/settings').set(bearer(admin));
    expect(before.body.prompts.classify).toBe(before.body.defaultPrompts.classify);

    await ctx.http().put('/api/v1/ai/settings').set(bearer(admin)).send({ prompts: { classify: 'CUSTOM CLASSIFY PROMPT' } });
    await ai().complete({ task: 'classify', user: 'hello' });
    expect(requests.at(-1)!.system).toBe('CUSTOM CLASSIFY PROMPT');
    expect(requests.at(-1)!.model).toBe('claude-haiku-5-5');

    const reset = await ctx.http().post('/api/v1/ai/settings/reset-prompt/classify').set(bearer(admin));
    expect(reset.body.prompts.classify).toBe(reset.body.defaultPrompts.classify);
    await ai().complete({ task: 'classify', user: 'hello' });
    expect(requests.at(-1)!.system).toContain('triage');
  });

  it('POST /ai/test reports success and failure without throwing', async () => {
    expect((await ctx.http().post('/api/v1/ai/test').set(bearer(admin))).body).toMatchObject({ ok: false }); // not configured yet
    await configure();
    behaviour = async () => ({ text: 'OK', inputTokens: 5, outputTokens: 1 });
    expect((await ctx.http().post('/api/v1/ai/test').set(bearer(admin))).body).toMatchObject({ ok: true, reply: 'OK' });
    behaviour = async () => { throw new LlmError('401 invalid x-api-key', 401, false); };
    const bad = await ctx.http().post('/api/v1/ai/test').set(bearer(admin));
    expect(bad.body.ok).toBe(false);
    expect(bad.body.error).toContain('401');
  });

  it('end to end: real classifier classifies a masked message, logs usage and cost', async () => {
    await configure();
    const g = await ctx.http().post('/api/v1/client-groups').set(bearer(admin)).send({ telegramChatId: '-1001234567890', title: 'Silk Road', companyName: 'Silk Road' });
    await ctx.http().post('/api/v1/internal/userbot/messages').set(ctx.svc()).send({
      chatId: 'c:1234567890', messageId: '501', senderId: '9', senderName: 'Marina', outgoing: false, replyToMessageId: null, hasMedia: false,
      text: 'Telefoniya ishlamayapti, parol: Hunter22secret, token sk-ant-api03-abcdefghijklmnopqrstuv', date: new Date().toISOString(),
    });
    await ctx.app.get(IntakeService).processDue(new Date(Date.now() + 60_000));

    const t = await ctx.prisma.ticket.findFirstOrThrow({ where: { clientGroupId: g.body.id } });
    expect(t).toMatchObject({ systemType: 'BITRIX24', category: 'telephony', needsReview: false, summary: 'Telefoniya ishlamayapti' });

    // the provider only ever saw masked text
    const sent = requests.at(-1)!.user;
    expect(sent).toContain('[PAROL]');
    expect(sent).not.toContain('Hunter22secret');
    expect(sent).not.toContain('abcdefghijklmnopqrstuv');
    expect(requests.at(-1)!.system).toContain('triage');
    expect(sent).toContain('<messages>'); // customer text is delimited as data

    const usage = await ctx.prisma.aiUsageLog.findFirstOrThrow();
    expect(usage).toMatchObject({ task: 'classify', model: 'claude-haiku-5-5', inputTokens: 1000, outputTokens: 100, ok: true });
    expect(usage.costUsd).toBeCloseTo((1000 * 0.1 + 100 * 0.5) / 1_000_000);
    const u = await ctx.http().get('/api/v1/ai/usage').set(bearer(admin));
    expect(u.body.byTask[0]).toMatchObject({ task: 'classify' });
  });

  it('transient provider errors are retried; persistent failure is logged and the ticket still opens (fail-open)', async () => {
    await configure();
    let n = 0;
    behaviour = async () => {
      if (++n < 3) throw new LlmError('503', 503, true);
      return { text: JSON.stringify(VERDICT), inputTokens: 10, outputTokens: 5 };
    };
    expect((await ai().classify('Telefoniya ishlamayapti', [])).systemType).toBe('BITRIX24');
    expect(n).toBe(3);

    behaviour = async () => { throw new LlmError('500 upstream', 500, true); };
    await expect(ai().classify('x', [])).rejects.toThrow('500');
    const failed = await ctx.prisma.aiUsageLog.findMany({ where: { ok: false } });
    expect(failed).toHaveLength(1);
    expect(failed[0].error).toContain('500');
  });

  it('circuit breaker: after 5 consecutive failures calls fail fast without touching the provider', async () => {
    await configure();
    behaviour = async () => { throw new LlmError('bad request', 400, false); };
    for (let i = 0; i < 5; i++) await expect(ai().classify('x', [])).rejects.toThrow();
    const calls = requests.length;
    await expect(ai().classify('x', [])).rejects.toThrow(/circuit breaker/);
    expect(requests).toHaveLength(calls);
  });

  it('monthly budget hard stop blocks calls; turning the hard stop off allows them again', async () => {
    await configure();
    await ctx.prisma.aiUsageLog.create({ data: { task: 'classify', model: 'claude-haiku-5-5', costUsd: 10.5 } });
    await expect(ai().complete({ task: 'classify', user: 'x' })).rejects.toThrow(/budget/);
    expect(requests).toHaveLength(0);
    await ctx.http().put('/api/v1/ai/settings').set(bearer(admin)).send({ hardStop: false });
    await expect(ai().complete({ task: 'classify', user: 'x' })).resolves.toBeDefined();
  });

  it('unconfigured AI fails open: the ticket is opened for review', async () => {
    const g = await ctx.http().post('/api/v1/client-groups').set(bearer(admin)).send({ telegramChatId: '-1001234567890', title: 'X', companyName: 'X' });
    await ctx.http().post('/api/v1/internal/userbot/messages').set(ctx.svc()).send({
      chatId: 'c:1234567890', messageId: '9', senderId: '1', senderName: 'A', outgoing: false, replyToMessageId: null, hasMedia: false,
      text: 'Tizimga kirib bo\'lmayapti, yordam bering', date: new Date().toISOString(),
    });
    await ctx.app.get(IntakeService).processDue(new Date(Date.now() + 60_000));
    const t = await ctx.prisma.ticket.findFirstOrThrow({ where: { clientGroupId: g.body.id } });
    expect(t).toMatchObject({ needsReview: true, aiConfidence: null });
  });
});
