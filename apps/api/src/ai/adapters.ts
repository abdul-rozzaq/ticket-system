import Anthropic from '@anthropic-ai/sdk';

export interface LlmRequest {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
}
export interface LlmResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}
export interface LlmAdapter {
  complete(req: LlmRequest): Promise<LlmResult>;
}

/** Error carrying an HTTP-ish status so the retry policy can tell transient failures from permanent ones. */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
  }
}

/** Models that accept (and benefit from) `output_config.effort`; classification does not need deep thinking. */
const EFFORT_MODELS = /^claude-(opus-5|sonnet-5|haiku-5|fable-5|mythos-5)/;

export class AnthropicAdapter implements LlmAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl?: string | null,
  ) {}

  async complete(req: LlmRequest): Promise<LlmResult> {
    const client = new Anthropic({ apiKey: this.apiKey, baseURL: this.baseUrl || undefined, timeout: req.timeoutMs, maxRetries: 0 });
    try {
      // temperature is deliberately NOT sent: current Claude models reject non-default sampling parameters.
      const params: Record<string, unknown> = {
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
      };
      if (EFFORT_MODELS.test(req.model)) params.output_config = { effort: 'low' };
      const res = (await client.messages.create(params as never)) as unknown as Anthropic.Message;
      if (res.stop_reason === 'refusal') throw new LlmError('model refused the request', 200, false);
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();
      return { text, inputTokens: res.usage?.input_tokens ?? 0, outputTokens: res.usage?.output_tokens ?? 0 };
    } catch (e) {
      if (e instanceof LlmError) throw e;
      if (e instanceof Anthropic.APIError) {
        throw new LlmError(`Anthropic ${e.status ?? ''}: ${e.message}`.slice(0, 300), e.status, e.status === 429 || (e.status ?? 0) >= 500);
      }
      // network / timeout
      throw new LlmError(`Anthropic request failed: ${String(e)}`.slice(0, 300), undefined, true);
    }
  }
}

export class OpenAiCompatAdapter implements LlmAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async complete(req: LlmRequest): Promise<LlmResult> {
    const url = `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: req.model,
          max_tokens: req.maxTokens,
          temperature: req.temperature,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
        }),
        signal: AbortSignal.timeout(req.timeoutMs),
      });
    } catch (e) {
      throw new LlmError(`request failed: ${String(e)}`.slice(0, 300), undefined, true);
    }
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 200);
      throw new LlmError(`${res.status}: ${body}`, res.status, res.status === 429 || res.status >= 500);
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    return {
      text: String(json.choices?.[0]?.message?.content ?? '').trim(),
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
    };
  }
}

/** Retry transient failures with exponential backoff + jitter. */
export async function withRetry<T>(fn: () => Promise<T>, opts: { retries: number; baseMs: number; sleep?: (ms: number) => Promise<void> }): Promise<T> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      const retryable = e instanceof LlmError && e.retryable;
      if (!retryable || attempt >= opts.retries) throw e;
      await sleep(opts.baseMs * 2 ** attempt + Math.floor(Math.random() * opts.baseMs));
      attempt++;
    }
  }
}

/** After N consecutive failures the breaker opens and calls fail fast until the cool-down passes (then one probe). */
export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  constructor(
    private readonly threshold = 5,
    private readonly coolDownMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  get isOpen(): boolean {
    return this.failures >= this.threshold && this.now() - this.openedAt < this.coolDownMs;
  }
  onSuccess() {
    this.failures = 0;
  }
  onFailure() {
    this.failures++;
    if (this.failures >= this.threshold) this.openedAt = this.now();
  }
}

/** Rough list prices (USD per 1M tokens: input/output) for the usage table. Unknown models cost 0 in the estimate. */
const PRICES: Array<[RegExp, number, number]> = [
  [/^claude-haiku-5-5/, 0.1, 0.5],
  [/^claude-sonnet-5/, 2, 10],
  [/^claude-opus-5-5/, 4, 20],
  [/^claude-opus-(5|4)/, 5, 25],
  [/^claude-fable|^claude-mythos/, 10, 50],
  [/^claude-haiku-4/, 1, 5],
];
export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES.find(([re]) => re.test(model));
  return p ? (inputTokens * p[1] + outputTokens * p[2]) / 1_000_000 : 0;
}
