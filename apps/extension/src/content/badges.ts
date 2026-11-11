// F11: status dots in the chat list. This is the one feature that injects nodes into Telegram's own DOM
// (an overlay would have to track every row while scrolling). Nodes carry data-tp so we can find/skip them.
import { debounce, detectVersion, q, qAll, textOf, warn } from '../telegram/dom';
import { CHAT_LIST_PEER_ATTRS } from '../telegram/selectors';
import { pageKeyCandidates } from '../telegram/peer-key';
import { setHealth } from './health';

export type BadgeState = 'open' | 'waiting' | 'overdue' | 'new';
export interface BadgeInfo {
  state: BadgeState;
  /** shown in the tooltip after the state text, e.g. the ticket id/number */
  label: string;
}
/** Decides which dot (if any) a chat list row gets. Pure and swappable (unit-tested). */
export type BadgeLookup = (peerId: string | null, title: string) => BadgeInfo | null;

/** One row of GET /tickets/open-chats. */
export interface OpenChat {
  number: number;
  status: 'NEW' | 'IN_PROGRESS' | 'WAITING_CLIENT' | 'CLOSED';
  overdue: boolean;
  chatKey: string;
  title: string;
}

/** Server mode: match by canonical chat key (any key the page id can map to), falling back to the exact title. */
export function serverLookup(rows: OpenChat[]): BadgeLookup {
  const byKey = new Map(rows.map((r) => [r.chatKey, r]));
  const byTitle = new Map(rows.map((r) => [r.title.trim().toLowerCase(), r]));
  return (peerId, title) => {
    let row: OpenChat | undefined;
    for (const k of pageKeyCandidates(peerId)) if ((row = byKey.get(k))) break;
    row ??= title ? byTitle.get(title.trim().toLowerCase()) : undefined;
    if (!row || row.status === 'CLOSED') return null;
    return {
      state: row.overdue ? 'overdue' : row.status === 'WAITING_CLIENT' ? 'waiting' : row.status === 'NEW' ? 'new' : 'open',
      label: `#${row.number}`,
    };
  };
}
const COLORS: Record<BadgeState, string> = { new: '#ff9800', open: '#3390ec', waiting: '#9c27b0', overdue: '#e53935' };
const TITLES: Record<BadgeState, string> = { new: 'TP: yangi tiket', open: 'TP: ochiq tiket', waiting: 'TP: mijoz kutilmoqda', overdue: "TP: SLA o'tgan" };

function peerIdOf(item: Element): string | null {
  const v = detectVersion() === 'a' ? 'a' : 'k';
  for (const attr of CHAT_LIST_PEER_ATTRS[v]) {
    const el = item.hasAttribute(attr) ? item : item.querySelector(`[${attr}]`);
    const val = el?.getAttribute(attr);
    if (val) return attr === 'href' ? val.replace(/^#/, '') || null : val;
  }
  return null;
}

export class Badges {
  private obs: MutationObserver | null = null;
  private list: Element | null = null;
  private lookup: BadgeLookup | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private enabled = false;
  private run = debounce(() => this.paint(), 300);

  start(lookup: BadgeLookup) {
    this.lookup = lookup;
    if (this.enabled) return this.run();
    this.enabled = true;
    this.attach();
    this.timer = setInterval(() => this.attach(), 3000); // the list element is replaced on folder switch
    this.paint();
  }

  update(lookup: BadgeLookup) {
    this.lookup = lookup;
    if (this.enabled) this.run();
  }

  stop() {
    this.enabled = false;
    this.obs?.disconnect();
    clearInterval(this.timer);
    document.querySelectorAll('[data-tp-badge]').forEach((n) => n.remove());
  }

  private attach() {
    const list = q('chatList');
    if (list === this.list) return;
    this.obs?.disconnect();
    this.list = list;
    if (!list) {
      setHealth('F11', 'FAILED', "chatlar ro'yxati topilmadi");
      return;
    }
    this.obs = new MutationObserver((records) => {
      // Ignore mutations caused only by our own badges.
      const foreign = records.some((r) =>
        [...Array.from(r.addedNodes), ...Array.from(r.removedNodes)].some((n) => !(n instanceof Element && n.hasAttribute('data-tp-badge'))),
      );
      if (foreign) this.run();
    });
    this.obs.observe(list, { childList: true, subtree: true });
    this.run();
  }

  private paint() {
    if (!this.enabled || !this.lookup) return;
    const t0 = performance.now();
    let painted = 0;
    try {
      const items = qAll('chatListItem');
      for (const item of items) {
        const id = peerIdOf(item);
        const titleEl = q('chatListItemTitle', item);
        const title = textOf(titleEl);
        const info = this.lookup(id, title);
        const existing = item.querySelector<HTMLElement>('[data-tp-badge]');
        if (!info) {
          existing?.remove();
          continue;
        }
        const state = info.state;
        painted++;
        if (existing?.dataset.tpBadge === state && existing.dataset.tpLabel === info.label) continue;
        const dot = existing ?? document.createElement('span');
        dot.setAttribute('data-tp-badge', state);
        dot.setAttribute('data-tp-label', info.label);
        dot.setAttribute('data-tp', '1');
        dot.title = `${TITLES[state]} ${info.label}`;
        dot.style.cssText = `display:inline-block;width:8px;height:8px;border-radius:50%;margin:0 4px;vertical-align:middle;flex:none;background:${COLORS[state]};box-shadow:0 0 0 2px rgba(255,255,255,.6)`;
        if (!existing) (titleEl?.parentElement ?? item).appendChild(dot);
      }
      const ms = performance.now() - t0;
      setHealth('F11', items.length ? 'OK' : 'DEGRADED', `${items.length} qator, ${painted} belgi, ${ms.toFixed(1)} ms`);
    } catch (e) {
      warn('badges paint failed', e);
      setHealth('F11', 'FAILED', String(e));
    }
  }
}
