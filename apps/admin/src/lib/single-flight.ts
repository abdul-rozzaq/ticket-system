/**
 * Collapses concurrent calls with the same key into one, and remembers the result for `ttlMs`.
 * Used for refresh-token rotation: the browser fires several parallel requests carrying the same old refresh
 * token; only the first may hit the API (the API revokes a reused token), the rest reuse its result.
 * Limitation: in-process only. With several panel instances behind a load balancer use sticky sessions.
 */
export class SingleFlight<T> {
  private readonly entries = new Map<string, { promise: Promise<T>; expires: number }>();

  constructor(private readonly ttlMs = 30_000) {}

  run(key: string, fn: () => Promise<T>, now = Date.now()): Promise<T> {
    this.sweep(now);
    const hit = this.entries.get(key);
    if (hit) return hit.promise;
    const promise = fn();
    this.entries.set(key, { promise, expires: now + this.ttlMs });
    // do not cache failures
    promise.catch(() => this.entries.delete(key));
    return promise;
  }

  private sweep(now: number) {
    for (const [k, v] of this.entries) if (v.expires <= now) this.entries.delete(k);
  }

  get size() {
    return this.entries.size;
  }
}
