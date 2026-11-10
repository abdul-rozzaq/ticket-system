import { describe, expect, it } from 'vitest';
import { fromMtproto, normalizePeerId, parseStoredPeer, samePeer, storePeer, toWebHash } from '../src/peer-id';

describe('normalizePeerId', () => {
  it.each([
    ['777000', 'u:777000'],
    ['#777000', 'u:777000'],
    ['-1001234567890', 'c:1234567890'],
    ['-1234567890', 'x:1234567890'], // WebK style: ambiguous
    ['-4567', 'x:4567'], // small basic group
    ['@Durov', 'n:durov'],
    [-1009876543210, 'c:9876543210'],
  ])('%s -> %s', (input, key) => {
    expect(normalizePeerId(input)?.key).toBe(key);
  });

  it.each([[''], ['abc'], ['@x'], ['12a'], [null], [undefined], ['--5']])('rejects %s', (input) => {
    expect(normalizePeerId(input as string)).toBeNull();
  });

  it('does not treat -100xxxxx short ids as channels', () => {
    // -1001 would be a basic group whose chat id is 1001, not a channel.
    expect(normalizePeerId('-1001')?.key).toBe('x:1001');
  });
});

describe('samePeer', () => {
  it('matches a Bot API/WebA id with the MTProto channel id', () => {
    expect(samePeer(normalizePeerId('-1001234567890'), fromMtproto('channel', 1234567890n))).toBe(true);
  });
  it('matches a WebK ambiguous id with either a channel or a chat', () => {
    const web = normalizePeerId('-1234567890');
    expect(samePeer(web, fromMtproto('channel', 1234567890))).toBe(true);
    expect(samePeer(web, fromMtproto('chat', 1234567890))).toBe(true);
  });
  it('does not match different numbers or users with groups', () => {
    expect(samePeer(normalizePeerId('-1234567890'), fromMtproto('channel', 1234567891))).toBe(false);
    expect(samePeer(normalizePeerId('1234567890'), fromMtproto('channel', 1234567890))).toBe(false);
    expect(samePeer(null, normalizePeerId('1'))).toBe(false);
  });
});

describe('storage + web hash', () => {
  it('round-trips through the stored key', () => {
    for (const raw of ['-1001234567890', '-123456', '99', '@somebody']) {
      const p = normalizePeerId(raw)!;
      expect(parseStoredPeer(storePeer(p))).toEqual(p);
    }
    expect(parseStoredPeer('zzz')).toBeNull();
  });
  it('builds WebA hashes', () => {
    expect(toWebHash(fromMtproto('channel', 1234567890))).toBe('-1001234567890');
    expect(toWebHash(fromMtproto('chat', 55))).toBe('-55');
    expect(toWebHash(fromMtproto('user', 7))).toBe('7');
  });
});
