export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const backoffMs = (attempt: number, baseMs = 500, capMs = 30_000): number =>
  Math.min(capMs, baseMs * 2 ** attempt);

/** Serialises calls and keeps a minimum gap between them. */
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
    this.chain = next.catch(() => undefined);
    return next;
  }
}

/**
 * Telegram's Bot API allows ~1 message/second per private chat, ~20/minute per group and ~30/second overall.
 * One limiter per chat (plus a small global gap) keeps card bursts inside those limits.
 */
export class ChatRateLimiter {
  private readonly perChat = new Map<string, RateLimiter>();
  private readonly global: RateLimiter;

  constructor(
    private readonly gaps: { global: number; group: number; private: number },
    private readonly sleep: Sleep = realSleep,
  ) {
    this.global = new RateLimiter(gaps.global, sleep);
  }

  run<T>(chatId: string, fn: () => Promise<T>): Promise<T> {
    let l = this.perChat.get(chatId);
    if (!l) {
      l = new RateLimiter(chatId.startsWith('-') ? this.gaps.group : this.gaps.private, this.sleep);
      this.perChat.set(chatId, l);
    }
    return l.run(() => this.global.run(fn));
  }
}
