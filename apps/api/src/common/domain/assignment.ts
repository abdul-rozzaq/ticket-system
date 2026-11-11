// Pure assignment strategies (no DB). The caller loads candidates and applies the result through TicketsService.assign().
import type { AssignmentStrategy, WorkingHours } from '@tp/shared';

export interface Candidate {
  id: string;
  isActive: boolean;
  /** /free (true) or /busy (false) */
  available: boolean;
  onDuty: boolean;
  openCount: number;
  lastAssignedAt: Date | null;
  workingHours?: WorkingHours | null;
}

export interface AssignContext {
  now?: Date;
  fixedOwnerId?: string | null;
  /** Person who handled this client's previous ticket (used for the "suggested" hint). */
  lastHandlerId?: string | null;
}

/** Is `now` inside the person's working days/hours (in their time zone)? No schedule = always working. */
export function isWithinWorkingHours(wh: WorkingHours | null | undefined, now = new Date()): boolean {
  if (!wh) return true;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: wh.tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const hhmm = `${get('hour')}:${get('minute')}`;
  return wh.days.includes(day) && hhmm >= wh.from && hhmm < wh.to;
}

const eligible = (c: Candidate) => c.isActive && c.available;
const byLoad = (a: Candidate, b: Candidate) =>
  a.openCount - b.openCount ||
  (a.lastAssignedAt?.getTime() ?? 0) - (b.lastAssignedAt?.getTime() ?? 0) ||
  a.id.localeCompare(b.id);
const byLeastRecent = (a: Candidate, b: Candidate) =>
  (a.lastAssignedAt?.getTime() ?? 0) - (b.lastAssignedAt?.getTime() ?? 0) || a.id.localeCompare(b.id);

/** Returns the user id to auto-assign, or null (= leave the ticket in "Yangi" for manual buttons). */
export function pickAssignee(
  strategy: AssignmentStrategy,
  candidates: Candidate[],
  ctx: AssignContext = {},
): string | null {
  const pool = candidates.filter(eligible);
  switch (strategy) {
    case 'MANUAL':
      return null;
    case 'FIXED_OWNER':
      // The owner gets it even when busy: that is the point of a fixed owner. Inactive owners are skipped.
      return candidates.find((c) => c.id === ctx.fixedOwnerId && c.isActive)?.id ?? null;
    case 'ROUND_ROBIN':
      return [...pool].sort(byLeastRecent)[0]?.id ?? null;
    case 'LEAST_LOADED':
      return [...pool].sort(byLoad)[0]?.id ?? null;
    case 'ON_DUTY': {
      const now = ctx.now ?? new Date();
      const duty = pool.filter((c) => c.onDuty && isWithinWorkingHours(c.workingHours, now));
      return [...duty].sort(byLoad)[0]?.id ?? null;
    }
  }
}

/** Hint shown on manual cards: the previous handler if available, else the least loaded available person. */
export function suggestAssignee(candidates: Candidate[], ctx: AssignContext = {}): string | null {
  const pool = candidates.filter(eligible);
  const prev = pool.find((c) => c.id === ctx.lastHandlerId);
  return prev?.id ?? [...pool].sort(byLoad)[0]?.id ?? null;
}
