import { randomBytes } from 'node:crypto';
import { CryptoService } from './crypto.service';
import type { Env } from '../config/env';

const make = () => new CryptoService({ ENCRYPTION_KEY: randomBytes(32).toString('base64') } as Env);

describe('CryptoService', () => {
  it('round-trips and never repeats ciphertext for the same plaintext', () => {
    const c = make();
    const a = c.encrypt('telegram-session-string');
    const b = c.encrypt('telegram-session-string');
    expect(a).not.toBe(b);
    expect(a.startsWith('v1.')).toBe(true);
    expect(c.decrypt(a)).toBe('telegram-session-string');
    expect(c.decrypt(c.encrypt('ўзбекча 🙂'))).toBe('ўзбекча 🙂');
  });

  it('detects tampering and wrong keys', () => {
    const c = make();
    const e = c.encrypt('secret');
    const parts = e.split('.');
    const flipped = [parts[0], parts[1], parts[2], Buffer.from('xxxxxx').toString('base64url')].join('.');
    expect(() => c.decrypt(flipped)).toThrow();
    expect(() => make().decrypt(e)).toThrow();
    expect(() => c.decrypt('garbage')).toThrow();
  });

  it('generates hashes, tokens and codes', () => {
    const c = make();
    expect(c.sha256('a')).toHaveLength(64);
    expect(c.randomToken()).not.toBe(c.randomToken());
    expect(c.randomCode(8)).toMatch(/^[A-Z2-9]{8}$/);
    expect(c.safeEqual('abc', 'abc')).toBe(true);
    expect(c.safeEqual('abc', 'abd')).toBe(false);
  });
});
