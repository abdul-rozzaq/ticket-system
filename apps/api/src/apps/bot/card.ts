// Renders the internal-group ticket card (pure: no DB, no Telegram). Output is Telegram HTML + an inline keyboard model.
import { encodeCallback, maskSensitive, t, toTmeLink, parseStoredPeer } from '@tp/shared';

export interface KeyboardButton {
  text: string;
  /** callback_data (<= 64 bytes) */
  callback?: string;
  url?: string;
}
export type Keyboard = KeyboardButton[][];
export interface RenderedCard {
  text: string;
  keyboard: Keyboard;
}

export interface CardStaff {
  id: string;
  name: string;
  openCount: number;
}

export interface CardInput {
  ticket: {
    number: number;
    status: 'NEW' | 'IN_PROGRESS' | 'WAITING_CLIENT' | 'CLOSED';
    urgency: 'LOW' | 'NORMAL' | 'HIGH';
    summary: string;
    systemType: string;
    category: string;
    openedAt: Date;
    needsReview: boolean;
    solutionNote: string | null;
    assigneeName: string | null;
  };
  company: string;
  /** Original customer text (will be masked and trimmed here). */
  firstText: string;
  /** Canonical peer key of the customer chat, for the "open chat" link. */
  chatKey: string;
  /** Staff who may be assigned (available + active). */
  staff: CardStaff[];
  suggestedId?: string | null;
  /** Show the reassign menu instead of the normal buttons. */
  reassignMenu?: boolean;
  tz?: string;
}

const BADGE = { HIGH: '🔴', NORMAL: '🟠', LOW: '🟢' } as const;
const SYSTEM_LABEL: Record<string, string> = {
  AMOCRM: 'AmoCRM',
  BITRIX24: 'Bitrix24',
  PBX: 'PBX',
  OTHER: 'Boshqa',
};

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const trim = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export function formatTime(d: Date, tz = 'Asia/Tashkent'): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    hourCycle: 'h23',
  })
    .format(d)
    .replace(',', '');
}

export function renderCard(c: CardInput): RenderedCard {
  const tk = c.ticket;
  const lines: string[] = [];
  lines.push(
    `${BADGE[tk.urgency]} <b>#${tk.number}</b> · ${escapeHtml(c.company)} · ${SYSTEM_LABEL[tk.systemType] ?? tk.systemType}`,
  );
  // The summary may be a copy of the customer's text (manual tickets, AI off): mask it like the body.
  if (tk.summary) lines.push(`<i>${escapeHtml(trim(maskSensitive(tk.summary).text, 200))}</i>`);
  // Secrets must not be copied into a Telegram group: mask, then trim.
  const body = trim(maskSensitive(c.firstText).text.replace(/\s+/g, ' ').trim(), 300);
  if (body) lines.push(`«${escapeHtml(body)}»`);
  lines.push(
    `🕐 ${formatTime(tk.openedAt, c.tz)}${tk.needsReview ? ' · ⚠️ AI ishonchsiz — tekshiring' : ''}`,
  );

  const chatUrl = (() => {
    const ref = parseStoredPeer(c.chatKey);
    return ref ? toTmeLink(ref) : null;
  })();
  const linkRow: KeyboardButton[] = chatUrl ? [{ text: t('bot.openChat'), url: chatUrl }] : [];
  const keyboard: Keyboard = [];

  if (tk.status === 'CLOSED') {
    lines.push(
      `✅ ${t('status.CLOSED')}${tk.solutionNote ? `: ${escapeHtml(trim(tk.solutionNote, 200))}` : ''}`,
    );
    if (linkRow.length) keyboard.push(linkRow);
    return { text: lines.join('\n'), keyboard };
  }

  if (c.reassignMenu) {
    for (const s of c.staff)
      keyboard.push([
        { text: `👤 ${s.name} (${s.openCount})`, callback: encodeCallback('assign', tk.number, s.id) },
      ]);
    keyboard.push([{ text: '⬅️', callback: encodeCallback('back', tk.number) }]);
    return { text: lines.join('\n'), keyboard };
  }

  if (!tk.assigneeName) {
    // Unassigned: "Men olaman", one button per available staff member, snooze + link.
    const sug = c.staff.find((s) => s.id === c.suggestedId);
    if (sug) lines.push(t('bot.recommend', { name: escapeHtml(sug.name) }));
    keyboard.push([{ text: t('bot.takeButton'), callback: encodeCallback('take', tk.number) }]);
    // Two staff buttons per row keeps the card compact when the team grows.
    for (let i = 0; i < c.staff.length; i += 2) {
      keyboard.push(
        c.staff.slice(i, i + 2).map((s) => ({
          text: `👤 ${s.name} (${s.openCount})`,
          callback: encodeCallback('assign', tk.number, s.id),
        })),
      );
    }
    keyboard.push([
      { text: t('bot.snoozeButton'), callback: encodeCallback('snooze', tk.number) },
      ...linkRow,
    ]);
    return { text: lines.join('\n'), keyboard };
  }

  lines.push(
    tk.status === 'WAITING_CLIENT'
      ? `⏳ ${t('status.WAITING_CLIENT')} · 👤 ${escapeHtml(tk.assigneeName)}`
      : t('ticket.taken', { name: escapeHtml(tk.assigneeName) }),
  );
  keyboard.push([
    { text: t('bot.reassign'), callback: encodeCallback('reassign', tk.number) },
    { text: `✅ ${t('bot.done')}`, callback: encodeCallback('done', tk.number) },
  ]);
  const second: KeyboardButton[] = [];
  if (tk.status !== 'WAITING_CLIENT')
    second.push({ text: `⏳ ${t('bot.wait')}`, callback: encodeCallback('wait', tk.number) });
  second.push(...linkRow);
  if (second.length) keyboard.push(second);
  return { text: lines.join('\n'), keyboard };
}
