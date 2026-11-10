import { describe, expect, it } from 'vitest';
import { encodeCallback, parseCallback, userShortId } from '../src/bot-callbacks';
import { fromMtproto, toTmeLink } from '../src/peer-id';

describe('callback codec', () => {
  const uid = '4875fbba-2771-459c-aaa7-2fc6ca442a6e';
  it('round-trips every action', () => {
    expect(parseCallback(encodeCallback('take', 42))).toEqual({
      action: 'take',
      ticketNumber: 42,
      userShort: undefined,
    });
    expect(parseCallback(encodeCallback('assign', 7, uid))).toEqual({
      action: 'assign',
      ticketNumber: 7,
      userShort: '4875fbba',
    });
    for (const a of ['snooze', 'reassign', 'back', 'done', 'wait'] as const)
      expect(parseCallback(encodeCallback(a, 5))?.action).toBe(a);
  });
  it('stays under Telegram’s 64-byte limit', () => {
    expect(encodeCallback('assign', 999999999, uid).length).toBeLessThan(64);
  });
  it('rejects malformed or tampered data', () => {
    for (const bad of [
      '',
      'x:1',
      'k:',
      'k:abc',
      'a:5',
      'k:5:4875fbba',
      'a:5:ZZZZZZZZ',
      'k:12345678901',
      null,
      undefined,
      'k:5 ',
    ]) {
      expect(parseCallback(bad as string)).toBeNull();
    }
    expect(userShortId(uid)).toBe('4875fbba');
  });
  it('builds t.me links only for supergroups/channels', () => {
    expect(toTmeLink(fromMtproto('channel', 1234567890))).toBe('https://t.me/c/1234567890/1');
    expect(toTmeLink(fromMtproto('channel', 1234567890), 55)).toBe('https://t.me/c/1234567890/55');
    expect(toTmeLink(fromMtproto('chat', 55))).toBeNull();
  });
});
