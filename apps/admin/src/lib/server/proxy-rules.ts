import { BLOCKED_PREFIXES, CSRF_HEADER, CSRF_VALUE } from './config';

/** Normalised path (no traversal, no empty segments) or null when the path is not allowed. */
export function safePath(segments: string[]): string | null {
  if (!segments.length) return null;
  const decoded = segments.map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return null;
    }
  });
  if (
    decoded.some(
      (s) => s === null || s === '' || s === '.' || s === '..' || s.includes('/') || s.includes('\\'),
    )
  )
    return null;
  if (BLOCKED_PREFIXES.includes((decoded[0] as string).toLowerCase())) return null;
  return segments.join('/');
}

export function csrfOk(method: string, headers: { get(name: string): string | null }): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) return true;
  return headers.get(CSRF_HEADER) === CSRF_VALUE;
}
