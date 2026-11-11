// F7: read the last N messages of the open chat from the DOM. Fragile by nature:
// only what is currently rendered (virtualised list) can be read.
import type { ParsedMessage, TgVersion } from '../shared/types';
import { closestOf, detectVersion, q, qAll, safe, textOf } from './dom';
import { MESSAGE_ID_ATTRS, OUTGOING_MARKERS } from './selectors';

export function messageIdOf(bubble: Element, version: TgVersion): string | null {
  const v = version === 'a' ? 'a' : 'k';
  for (const attr of MESSAGE_ID_ATTRS[v]) {
    const val = bubble.getAttribute(attr);
    if (val) return attr === 'id' ? val.replace(/^message-/, '') : val;
  }
  return null;
}

export function isOutgoing(bubble: Element, version: TgVersion): boolean {
  const v = version === 'a' ? 'a' : 'k';
  return OUTGOING_MARKERS[v].some((sel) => bubble.matches(sel) || !!bubble.querySelector(`:scope > ${sel}`));
}

export function parseBubble(bubble: Element, version: TgVersion = detectVersion()): ParsedMessage | null {
  return safe(
    'parseBubble',
    () => {
      const textEl = q('messageText', bubble, version);
      const replyEl = q('messageReply', bubble, version);
      const timeEl = q('messageTime', bubble, version);
      const senderEl = q('messageSender', bubble, version);
      let text = textOf(textEl);
      // Remove the reply quote and the time that are often nested inside the text container.
      if (replyEl && text.startsWith(textOf(replyEl))) text = text.slice(textOf(replyEl).length).trim();
      const time = timeEl ? textOf(timeEl).match(/\d{1,2}:\d{2}(\s?[AP]M)?/i)?.[0] ?? null : null;
      if (time && text.endsWith(time)) text = text.slice(0, -time.length).trim();
      if (!text) return null; // stickers, media, service messages
      return {
        id: messageIdOf(bubble, version),
        sender: senderEl ? textOf(senderEl) || null : null,
        outgoing: isOutgoing(bubble, version),
        text,
        time,
        replyTo: replyEl ? textOf(replyEl).slice(0, 120) || null : null,
      };
    },
    null,
  );
}

/** Last N parsed messages, oldest first. Sender is carried forward for grouped bubbles. */
export function readMessages(limit = 20, version: TgVersion = detectVersion()): ParsedMessage[] {
  const bubbles = qAll('messageBubble', document, version).slice(-limit * 2);
  const out: ParsedMessage[] = [];
  let lastSender: string | null = null;
  for (const b of bubbles) {
    const m = parseBubble(b, version);
    if (!m) continue;
    if (m.sender) lastSender = m.sender;
    else if (!m.outgoing) m.sender = lastSender;
    out.push(m);
  }
  return out.slice(-limit);
}

export function lastIncoming(limit = 3, version: TgVersion = detectVersion()): ParsedMessage[] {
  return readMessages(30, version).filter((m) => !m.outgoing).slice(-limit);
}

export function bubbleFromEvent(target: EventTarget | null, version: TgVersion = detectVersion()): Element | null {
  return target instanceof Element ? closestOf(target, 'messageBubble', version) : null;
}
