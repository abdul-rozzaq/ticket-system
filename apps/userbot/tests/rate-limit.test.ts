import { describe, expect, it } from 'vitest';
import { backoffMs, floodWaitSeconds, RateLimiter, withFloodWait } from '../src/rate-limit';

class FloodWaitError extends Error {
  constructor(public seconds: number) {
    super(`A wait of ${seconds} seconds is required`);
  }
}

describe('floodWaitSeconds', () => {
  it('reads GramJS FloodWaitError objects and raw messages', () => {
    expect(floodWaitSeconds(new FloodWaitError(42))).toBe(42);
    expect(floodWaitSeconds(Object.assign(new Error('x'), { errorMessage: 'FLOOD_WAIT_17' }))).toBe(17);
    expect(
      floodWaitSeconds(new Error('A wait of 9 seconds is required (caused by messages.DeleteMessages)')),
    ).toBe(9);
  });
  it('is null for everything else', () => {
    expect(floodWaitSeconds(new Error('PHONE_CODE_INVALID'))).toBeNull();
    expect(floodWaitSeconds(null)).toBeNull();
    expect(floodWaitSeconds('FLOOD_WAIT_5')).toBeNull();
    expect(floodWaitSeconds(Object.assign(new Error('x'), { seconds: 5 }))).toBeNull(); // "seconds" alone is not proof
  });
});

describe('withFloodWait', () => {
  it('sleeps seconds+1 and retries', async () => {
    const sleeps: number[] = [];
    let n = 0;
    const r = await withFloodWait(
      async () => {
        if (++n === 1) throw new FloodWaitError(3);
        return 'done';
      },
      { sleep: async (ms) => void sleeps.push(ms) },
    );
    expect(r).toBe('done');
    expect(sleeps).toEqual([4000]);
  });

  it('does not sleep through absurd waits and does not retry other errors', async () => {
    const sleeps: number[] = [];
    await expect(
      withFloodWait(
        async () => {
          throw new FloodWaitError(3600);
        },
        { sleep: async (ms) => void sleeps.push(ms), maxWaitSeconds: 120 },
      ),
    ).rejects.toThrow();
    expect(sleeps).toEqual([]);
    let n = 0;
    await expect(
      withFloodWait(
        async () => {
          n++;
          throw new Error('AUTH_KEY_UNREGISTERED');
        },
        { sleep: async () => undefined },
      ),
    ).rejects.toThrow('AUTH_KEY');
    expect(n).toBe(1);
  });

  it('gives up after maxAttempts', async () => {
    let n = 0;
    await expect(
      withFloodWait(
        async () => {
          n++;
          throw new FloodWaitError(1);
        },
        { sleep: async () => undefined, maxAttempts: 3 },
      ),
    ).rejects.toThrow();
    expect(n).toBe(3);
  });
});

describe('RateLimiter', () => {
  it('serialises calls and enforces the minimum gap', async () => {
    let t = 0;
    const sleeps: number[] = [];
    const lim = new RateLimiter(
      400,
      async (ms) => {
        sleeps.push(ms);
        t += ms;
      },
      () => t,
    );
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3].map((i) =>
        lim.run(async () => {
          order.push(i);
        }),
      ),
    );
    expect(order).toEqual([1, 2, 3]);
    expect(sleeps).toEqual([400, 400]); // first call immediate, the next two wait the gap
  });

  it('a failing call does not poison the queue', async () => {
    const lim = new RateLimiter(0, async () => undefined);
    await expect(
      lim.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(lim.run(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('backoffMs', () => {
  it('grows exponentially and is capped', () => {
    expect([0, 1, 2, 3].map((a) => backoffMs(a, 500))).toEqual([500, 1000, 2000, 4000]);
    expect(backoffMs(20, 500, 30_000)).toBe(30_000);
  });
});
