import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SingleFlight } from '../src/lib/single-flight';
import { csrfOk, safePath } from '../src/lib/server/proxy-rules';
import { uz } from '../src/lib/i18n';
import { fmtMinutes, fmtRemaining, splitCsv } from '../src/lib/utils';

describe('SingleFlight (refresh-token rotation)', () => {
  it('runs the function once for concurrent callers with the same key', async () => {
    const sf = new SingleFlight<number>();
    let calls = 0;
    const fn = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return 42;
    };
    const rs = await Promise.all([sf.run('rt1', fn), sf.run('rt1', fn), sf.run('rt1', fn)]);
    expect(rs).toEqual([42, 42, 42]);
    expect(calls).toBe(1);
  });

  it('different keys run independently', async () => {
    const sf = new SingleFlight<string>();
    expect(await Promise.all([sf.run('a', async () => 'A'), sf.run('b', async () => 'B')])).toEqual([
      'A',
      'B',
    ]);
  });

  it('keeps the result for the ttl, then forgets it', async () => {
    const sf = new SingleFlight<number>(1000);
    let n = 0;
    const fn = async () => ++n;
    expect(await sf.run('k', fn, 0)).toBe(1);
    expect(await sf.run('k', fn, 500)).toBe(1);
    expect(await sf.run('k', fn, 1500)).toBe(2);
  });

  it('does not cache failures', async () => {
    const sf = new SingleFlight<number>();
    await expect(sf.run('k', async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await new Promise((r) => setTimeout(r, 0));
    expect(await sf.run('k', async () => 7)).toBe(7);
  });
});

describe('proxy rules', () => {
  it('allows normal API paths', () => {
    expect(safePath(['tickets'])).toBe('tickets');
    expect(safePath(['tickets', 'abc', 'close'])).toBe('tickets/abc/close');
    expect(safePath(['stats', 'export.csv'])).toBe('stats/export.csv');
  });

  it('blocks the service-token endpoints and traversal tricks', () => {
    expect(safePath([])).toBeNull();
    expect(safePath(['internal', 'bot', 'config'])).toBeNull();
    expect(safePath(['INTERNAL', 'userbot'])).toBeNull();
    expect(safePath(['%69nternal', 'bot'])).toBeNull(); // percent-encoded "i"
    expect(safePath(['..', 'internal'])).toBeNull();
    expect(safePath(['tickets', '..', 'internal'])).toBeNull();
    expect(safePath(['tickets', '%2e%2e', 'x'])).toBeNull();
    expect(safePath(['tickets', 'a%2Fb'])).toBeNull();
    expect(safePath(['tickets', ''])).toBeNull();
    expect(safePath(['%E0%A4%A'])).toBeNull(); // malformed encoding
  });

  it('requires the CSRF header on mutating requests only', () => {
    const h = (v?: string) => ({ get: (n: string) => (n === 'x-tp-csrf' ? (v ?? null) : null) });
    expect(csrfOk('GET', h())).toBe(true);
    expect(csrfOk('POST', h())).toBe(false);
    expect(csrfOk('DELETE', h('0'))).toBe(false);
    expect(csrfOk('POST', h('1'))).toBe(true);
    expect(csrfOk('patch', h())).toBe(false);
  });
});

describe('formatting helpers', () => {
  it('fmtMinutes', () => {
    expect(fmtMinutes(null)).toBe('—');
    expect(fmtMinutes(5)).toBe('5 daq');
    expect(fmtMinutes(60)).toBe('1 soat');
    expect(fmtMinutes(125)).toBe('2 soat 5 daq');
    expect(fmtMinutes(26 * 60)).toBe('1 kun 2 soat');
  });
  it('fmtRemaining shows overdue as negative', () => {
    const now = Date.parse('2026-01-01T12:00:00Z');
    expect(fmtRemaining('2026-01-01T12:30:00Z', now)).toBe('30 daq');
    expect(fmtRemaining('2026-01-01T11:30:00Z', now)).toBe('−30 daq');
    expect(fmtRemaining(null, now)).toBe('—');
  });
  it('splitCsv trims and drops empties', () => {
    expect(splitCsv(' a, b ,, c ')).toEqual(['a', 'b', 'c']);
    expect(splitCsv('')).toEqual([]);
  });
});

describe('i18n dictionary', () => {
  const root = path.resolve(__dirname, '../src');
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && e.name !== 'i18n.ts') files.push(p);
    }
  };
  walk(root);

  it('every literal t(...) key used in the code exists in the uz dictionary', () => {
    const missing: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) {
        if (!(m[1] in uz)) missing.push(`${path.relative(root, f)}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('dynamic key families are complete (status/urgency/system/role/strategy/reason)', () => {
    const need = [
      ...['NEW', 'IN_PROGRESS', 'WAITING_CLIENT', 'CLOSED'].map((s) => `status.${s}`),
      ...['HIGH', 'NORMAL', 'LOW'].map((s) => `urgency.${s}`),
      ...['AMOCRM', 'BITRIX24', 'PBX', 'OTHER'].map((s) => `system.${s}`),
      ...['ADMIN', 'STAFF'].map((s) => `role.${s}`),
      ...['MANUAL', 'FIXED_OWNER', 'ROUND_ROBIN', 'LEAST_LOADED', 'ON_DUTY'].map((s) => `strategy.${s}`),
      ...['EMPTY', 'EMOJI_ONLY', 'TOO_SHORT', 'ACKNOWLEDGEMENT', 'STAFF_MESSAGE', 'AI_NOT_REQUEST'].map(
        (s) => `reason.${s}`,
      ),
    ];
    expect(need.filter((k) => !(k in uz))).toEqual([]);
  });

  it('has a label for every setting key', async () => {
    const { DEFAULT_SETTINGS } = await import('@tp/shared');
    expect(Object.keys(DEFAULT_SETTINGS).filter((k) => !(`setting.${k}` in uz))).toEqual([]);
  });
});
