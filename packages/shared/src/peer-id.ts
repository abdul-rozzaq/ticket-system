// Telegram peer-id normalisation.
//
// The same chat shows up under different ids depending on where you look:
//  - Telegram Web /a/ and the Bot API: supergroup/channel = -100<channelId>, basic group = -<chatId>, user = <userId>
//  - Telegram Web /k/:                 channel/supergroup = -<channelId> (no 100 prefix), basic group = -<chatId>
//  - MTProto (GramJS):                 separate namespaces: channel id, chat id, user id (all positive)
// A WebK id like -1234567890 is therefore AMBIGUOUS (basic group or channel) until matched against known groups.

export type PeerKind = 'user' | 'chat' | 'channel' | 'ambiguous' | 'username';

export interface PeerRef {
  kind: PeerKind;
  /** Numeric id as a decimal string (without sign / -100 prefix), or the username without "@". */
  id: string;
  /** Canonical key: u:<id> | g:<id> | c:<id> | x:<id> (ambiguous) | n:<username>. */
  key: string;
}

const PREFIX: Record<PeerKind, string> = { user: 'u', chat: 'g', channel: 'c', ambiguous: 'x', username: 'n' };
const mk = (kind: PeerKind, id: string): PeerRef => ({ kind, id, key: `${PREFIX[kind]}:${id}` });

/** Parse a Telegram Web hash / Bot API style id ("-1001234567890", "-123", "777000", "@name"). Null if unparseable. */
export function normalizePeerId(input: string | number | null | undefined): PeerRef | null {
  if (input == null) return null;
  const s = String(input).trim().replace(/^#/, '');
  if (!s) return null;
  if (s.startsWith('@')) {
    const name = s.slice(1).toLowerCase();
    return /^[a-z][a-z0-9_]{2,31}$/.test(name) ? mk('username', name) : null;
  }
  if (!/^-?\d+$/.test(s)) return null;
  if (!s.startsWith('-')) return mk('user', s.replace(/^0+(?=\d)/, ''));
  const digits = s.slice(1);
  // Bot API / WebA supergroup or channel: -100<id>. A basic group id never looks like 100 + 9 more digits.
  if (digits.startsWith('100') && digits.length >= 12) return mk('channel', digits.slice(3));
  return mk('ambiguous', digits);
}

/** Build a PeerRef from an MTProto entity (what GramJS hands us). */
export function fromMtproto(kind: 'user' | 'chat' | 'channel', id: string | number | bigint): PeerRef {
  return mk(kind, String(id));
}

/** Do two refs point at the same Telegram peer? An ambiguous WebK id matches a chat or channel with the same number. */
export function samePeer(a: PeerRef | null, b: PeerRef | null): boolean {
  if (!a || !b) return false;
  if (a.key === b.key) return true;
  if (a.id !== b.id) return false;
  const amb = (p: PeerRef) => p.kind === 'ambiguous';
  const grp = (p: PeerRef) => p.kind === 'chat' || p.kind === 'channel';
  return (amb(a) && (grp(b) || amb(b))) || (amb(b) && grp(a));
}

/** Format a ref as the id Telegram Web /a/ puts in the URL hash (for deep links). */
export function toWebHash(ref: PeerRef): string {
  switch (ref.kind) {
    case 'channel':
      return `-100${ref.id}`;
    case 'chat':
    case 'ambiguous':
      return `-${ref.id}`;
    case 'username':
      return `@${ref.id}`;
    default:
      return ref.id;
  }
}

/** Compact string for DB storage; round-trips through parseStoredPeer. */
export const storePeer = (p: PeerRef): string => p.key;
export function parseStoredPeer(key: string): PeerRef | null {
  const m = /^([ugcxn]):(.+)$/.exec(key);
  if (!m) return null;
  const kinds: Record<string, PeerKind> = { u: 'user', g: 'chat', c: 'channel', x: 'ambiguous', n: 'username' };
  return mk(kinds[m[1]], m[2]);
}
