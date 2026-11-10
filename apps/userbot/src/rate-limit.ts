export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Serialises calls and keeps a minimum gap between them (MTProto punishes bursts with FLOOD_WAIT). */
export class RateLimiter {
  private chain: Promise<unknown> = Promise.resolve();
  private last = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly minGapMs: number,
    private readonly sleep: Sleep = realSleep,
    private readonly now: () => number = Date.now,
  ) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(async () => {
      const wait = this.last + this.minGapMs - this.now();
      if (wait > 0) await this.sleep(wait);
      try {
        return await fn();
      } finally {
        this.last = this.now();
      }
    });
    this.chain = next.catch(() => undefined); // a failed call must not break the queue
    return next;
  }
}

/** Seconds Telegram asked us to wait, from a GramJS FloodWaitError or a raw "FLOOD_WAIT_x" / "A wait of x seconds" message. */
export function floodWaitSeconds(e: unknown): number | null {
  if (!e || typeof e !== 'object') return null;
  const any = e as { seconds?: unknown; errorMessage?: unknown; message?: unknown };
  const name = String((e as { constructor?: { name?: string } }).constructor?.name ?? '');
  if (typeof any.seconds === 'number' && /Flood|SlowMode/i.test(name + String(any.errorMessage ?? '')))
    return any.seconds;
  const text = `${String(any.errorMessage ?? '')} ${String(any.message ?? '')}`;
  const m = /FLOOD_WAIT_(\d+)/.exec(text) ?? /wait of (\d+) seconds/i.exec(text);
  return m ? Number(m[1]) : null;
}

/**
 * Runs a Telegram call, honouring FLOOD_WAIT: sleeps for the requested time (+1 s margin) and retries.
 * Waits longer than maxWaitSeconds are NOT slept through (that would stall the worker): the error is rethrown.
 */
export async function withFloodWait<T>(
  fn: () => Promise<T>,
  opts: {
    sleep?: Sleep;
    maxWaitSeconds?: number;
    maxAttempts?: number;
    onWait?: (seconds: number) => void;
  } = {},
): Promise<T> {
  const sleep = opts.sleep ?? realSleep;
  const max = opts.maxWaitSeconds ?? 120;
  const attempts = opts.maxAttempts ?? 3;
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const s = floodWaitSeconds(e);
      if (s === null || s > max || i >= attempts) throw e;
      opts.onWait?.(s);
      await sleep((s + 1) * 1000);
    }
  }
}

/** Exponential backoff delays: base, 2*base, 4*base ... capped. */
export const backoffMs = (attempt: number, baseMs = 500, capMs = 30_000): number =>
  Math.min(capMs, baseMs * 2 ** attempt);
