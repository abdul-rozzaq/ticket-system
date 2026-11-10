// SLA math. Pure functions, unit-tested.
export interface SlaTicket { status: string; slaDeadline: string | Date }

export interface SlaInfo {
  /** ms left until deadline; negative when overdue. */
  remainingMs: number;
  overdue: boolean;
  /** Ticket is not counted against SLA (closed, or waiting for the client). */
  paused: boolean;
  label: string;
}

export function formatDuration(ms: number): string {
  const sign = ms < 0 ? '-' : '';
  let s = Math.floor(Math.abs(ms) / 1000);
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (d > 0) return `${sign}${d}k ${h}s`;
  if (h > 0) return `${sign}${h}:${pad(m)}:${pad(s)}`;
  return `${sign}${m}:${pad(s)}`;
}

export function slaInfo(t: SlaTicket, now = Date.now()): SlaInfo {
  const remainingMs = new Date(t.slaDeadline).getTime() - now;
  const paused = t.status === 'CLOSED' || t.status === 'WAITING_CLIENT';
  const overdue = !paused && remainingMs < 0;
  let label: string;
  if (t.status === 'CLOSED') label = 'yopilgan';
  else if (t.status === 'WAITING_CLIENT') label = 'mijoz javobi kutilmoqda';
  else label = overdue ? `muddati o'tdi ${formatDuration(-remainingMs)}` : `${formatDuration(remainingMs)} qoldi`;
  return { remainingMs, overdue, paused, label };
}

export const isOverdue = (t: SlaTicket, now = Date.now()) => slaInfo(t, now).overdue;
