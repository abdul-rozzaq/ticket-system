import { CircuitBreaker, estimateCostUsd, LlmError, OpenAiCompatAdapter, withRetry } from './adapters';
import { AiOutputError, parseClassification } from './ai.service';

const req = { model: 'm', system: 's', user: 'u', maxTokens: 100, temperature: 0.2, timeoutMs: 1000 };
const res = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('withRetry', () => {
  it('retries transient errors with growing backoff, then succeeds', async () => {
    const sleeps: number[] = [];
    let n = 0;
    const r = await withRetry(
      async () => {
        if (++n < 3) throw new LlmError('boom', 503, true);
        return 'ok';
      },
      { retries: 2, baseMs: 100, sleep: async (ms) => void sleeps.push(ms) },
    );
    expect(r).toBe('ok');
    expect(n).toBe(3);
    expect(sleeps).toHaveLength(2);
    expect(sleeps[1]).toBeGreaterThanOrEqual(200); // 100 * 2^1 (+ jitter)
  });

  it('gives up after the retry budget and never retries permanent errors', async () => {
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw new LlmError('x', 500, true);
        },
        { retries: 2, baseMs: 1, sleep: async () => undefined },
      ),
    ).rejects.toThrow('x');
    expect(n).toBe(3);
    n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw new LlmError('bad key', 401, false);
        },
        { retries: 5, baseMs: 1, sleep: async () => undefined },
      ),
    ).rejects.toThrow('bad key');
    expect(n).toBe(1);
    n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw new Error('not an LlmError');
        },
        { retries: 5, baseMs: 1, sleep: async () => undefined },
      ),
    ).rejects.toThrow();
    expect(n).toBe(1);
  });
});

describe('CircuitBreaker', () => {
  it('opens after the threshold, probes after the cool-down, closes on success', () => {
    let t = 0;
    const b = new CircuitBreaker(3, 1000, () => t);
    b.onFailure();
    b.onFailure();
    expect(b.isOpen).toBe(false);
    b.onFailure();
    expect(b.isOpen).toBe(true);
    t = 999;
    expect(b.isOpen).toBe(true);
    t = 1001;
    expect(b.isOpen).toBe(false); // half-open: one probe allowed
    b.onSuccess();
    b.onFailure();
    expect(b.isOpen).toBe(false); // counter was reset
  });
});

describe('OpenAiCompatAdapter', () => {
  it('posts to {base}/chat/completions with the bearer key and maps usage', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return res(200, {
        choices: [{ message: { content: '  hello ' } }],
        usage: { prompt_tokens: 12, completion_tokens: 3 },
      });
    }) as unknown as typeof fetch;
    const out = await new OpenAiCompatAdapter('sk-secret', 'https://llm.example/v1/', fetchImpl).complete(
      req,
    );
    expect(out).toEqual({ text: 'hello', inputTokens: 12, outputTokens: 3 });
    expect(seen!.url).toBe('https://llm.example/v1/chat/completions');
    expect((seen!.init.headers as Record<string, string>).authorization).toBe('Bearer sk-secret');
    expect(JSON.parse(seen!.init.body as string)).toMatchObject({
      model: 'm',
      messages: [{ role: 'system' }, { role: 'user' }],
    });
  });

  it('classifies failures: 429/5xx/network are retryable, 4xx are not', async () => {
    const mk = (f: () => Promise<Response>) =>
      new OpenAiCompatAdapter('k', 'https://x', f as unknown as typeof fetch).complete(req);
    await expect(mk(async () => res(429, {}))).rejects.toMatchObject({ retryable: true, status: 429 });
    await expect(mk(async () => res(502, {}))).rejects.toMatchObject({ retryable: true });
    await expect(mk(async () => res(401, { error: 'bad key' }))).rejects.toMatchObject({
      retryable: false,
      status: 401,
    });
    await expect(
      mk(async () => {
        throw new TypeError('fetch failed');
      }),
    ).rejects.toMatchObject({ retryable: true });
  });

  it('does not leak the API key into error messages', async () => {
    const a = new OpenAiCompatAdapter('sk-very-secret', 'https://x', (async () =>
      res(401, { error: 'invalid' })) as unknown as typeof fetch);
    await expect(a.complete(req)).rejects.not.toThrow(/sk-very-secret/);
  });
});

describe('parseClassification', () => {
  const ok = {
    isRequest: true,
    confidence: 0.8,
    systemType: 'PBX',
    category: 'sip',
    urgency: 'HIGH',
    language: 'ru',
    summary: 'x',
  };
  it('accepts plain JSON, fenced JSON and JSON surrounded by prose', () => {
    expect(parseClassification(JSON.stringify(ok)).systemType).toBe('PBX');
    expect(parseClassification('```json\n' + JSON.stringify(ok) + '\n```').urgency).toBe('HIGH');
    expect(parseClassification('Here you go: ' + JSON.stringify(ok) + ' Hope it helps').language).toBe('ru');
  });
  it('fills defaults and rejects garbage', () => {
    expect(parseClassification('{"isRequest": false, "confidence": 0.1}')).toMatchObject({
      systemType: 'OTHER',
      urgency: 'NORMAL',
    });
    expect(() => parseClassification('no json here')).toThrow(AiOutputError);
    expect(() => parseClassification('{"isRequest": true')).toThrow(AiOutputError);
    expect(() => parseClassification('{"isRequest": true, "confidence": 7}')).toThrow(AiOutputError);
    expect(() => parseClassification('{"confidence": 0.5}')).toThrow(AiOutputError);
  });
});

describe('estimateCostUsd', () => {
  it('prices known models and returns 0 for unknown ones', () => {
    expect(estimateCostUsd('claude-haiku-5-5', 1_000_000, 1_000_000)).toBeCloseTo(0.6);
    expect(estimateCostUsd('claude-opus-5-5', 1_000_000, 0)).toBeCloseTo(4);
    expect(estimateCostUsd('gpt-whatever', 1_000_000, 1_000_000)).toBe(0);
  });
});
