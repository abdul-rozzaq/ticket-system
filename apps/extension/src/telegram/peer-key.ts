// Maps the peer id Telegram Web shows to the canonical chat keys the server stores. Mirrors normalizePeerId +
// candidateKeys (@tp/shared / API); duplicated here so the content script does not bundle zod. A cross-check test keeps
// it identical. A WebK id like "-1234567890" is ambiguous (basic group or channel), so one page id can match several keys.
//   u:<id> user · g:<id> basic group · c:<id> channel/supergroup · x:<id> stored from an ambiguous id · n:<name> username
export function pageKeyCandidates(id: string | null | undefined): string[] {
  if (!id) return [];
  const s = id.trim().replace(/^#/, '');
  if (s.startsWith('@')) {
    const name = s.slice(1).toLowerCase();
    return /^[a-z][a-z0-9_]{2,31}$/.test(name) ? [`n:${name}`] : [];
  }
  if (!/^-?\d+$/.test(s)) return [];
  if (!s.startsWith('-')) return [`u:${s.replace(/^0+(?=\d)/, '')}`];
  const digits = s.slice(1);
  if (digits.startsWith('100') && digits.length >= 12) {
    const n = digits.slice(3);
    return [`c:${n}`, `x:${n}`];
  }
  return [`x:${digits}`, `c:${digits}`, `g:${digits}`];
}
