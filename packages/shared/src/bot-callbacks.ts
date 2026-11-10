// Inline-button callback data. Telegram limits it to 64 bytes, so it is compact and strictly parsed.
//   k:<ticketNo>                 "Men olaman" (take)
//   a:<ticketNo>:<userShort>     assign to a staff member (first 8 hex chars of the user id)
//   s:<ticketNo>                 snooze 10 minutes
//   r:<ticketNo>                 show the reassign menu
//   b:<ticketNo>                 back to the card
//   d:<ticketNo>                 done (close)
//   w:<ticketNo>                 waiting for the client
export type CallbackAction = 'take' | 'assign' | 'snooze' | 'reassign' | 'back' | 'done' | 'wait';

export interface ParsedCallback {
  action: CallbackAction;
  ticketNumber: number;
  /** For `assign`: the 8-char user id prefix. */
  userShort?: string;
}

const LETTER: Record<CallbackAction, string> = {
  take: 'k',
  assign: 'a',
  snooze: 's',
  reassign: 'r',
  back: 'b',
  done: 'd',
  wait: 'w',
};
const ACTION = Object.fromEntries(Object.entries(LETTER).map(([a, l]) => [l, a])) as Record<
  string,
  CallbackAction
>;

export const userShortId = (userId: string): string => userId.replace(/-/g, '').slice(0, 8);

export function encodeCallback(action: CallbackAction, ticketNumber: number, userId?: string): string {
  const base = `${LETTER[action]}:${ticketNumber}`;
  return action === 'assign' ? `${base}:${userShortId(userId ?? '')}` : base;
}

export function parseCallback(data: string | null | undefined): ParsedCallback | null {
  const m = /^([kasrbdw]):(\d{1,9})(?::([0-9a-f]{8}))?$/.exec(data ?? '');
  if (!m) return null;
  const action = ACTION[m[1]];
  if (action === 'assign' && !m[3]) return null;
  if (action !== 'assign' && m[3]) return null;
  return { action, ticketNumber: Number(m[2]), userShort: m[3] };
}
