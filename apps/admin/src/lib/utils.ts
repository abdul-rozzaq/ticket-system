import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

const TZ = 'Asia/Tashkent';

export function fmtDateTime(v: string | Date | null | undefined): string {
  if (!v) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(v));
}

export function fmtMinutes(m: number | null | undefined): string {
  if (m == null) return '—';
  if (m < 60) return `${Math.round(m)} daq`;
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  if (h < 24) return r ? `${h} soat ${r} daq` : `${h} soat`;
  const d = Math.floor(h / 24);
  return `${d} kun ${h % 24} soat`;
}

/** "5 daq", "2 soat" … relative to now; negative → overdue. */
export function fmtRemaining(deadline: string | Date | null | undefined, now = Date.now()): string {
  if (!deadline) return '—';
  const diff = Math.round((new Date(deadline).getTime() - now) / 60_000);
  return diff >= 0 ? fmtMinutes(diff) : `−${fmtMinutes(-diff)}`;
}

export const splitCsv = (s: string): string[] =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
