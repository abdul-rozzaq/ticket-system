// F11: status dots in the chat list. This is the one feature that injects nodes into Telegram's own DOM
// (an overlay would have to track every row while scrolling). Nodes carry data-tp so we can find/skip them.
import type { MockState } from '../shared/types';
import { findClientForChat, currentTicket } from '../logic/tickets';
import { isOverdue } from '../logic/sla';
import { debounce, detectVersion, q, qAll, textOf, warn } from '../telegram/dom';
import { CHAT_LIST_PEER_ATTRS } from '../telegram/selectors';
import { setHealth } from './health';

type BadgeState = 'open' | 'waiting' | 'overdue' | 'new';
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
  private mock: MockState | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private enabled = false;
  private run = debounce(() => this.paint(), 300);

  start(mock: MockState) {
    this.mock = mock;
    if (this.enabled) return this.run();
    this.enabled = true;
    this.attach();
    this.timer = setInterval(() => this.attach(), 3000); // the list element is replaced on folder switch
    this.paint();
  }

  update(mock: MockState) {
    this.mock = mock;
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
    if (!this.enabled || !this.mock) return;
    const t0 = performance.now();
    let painted = 0;
    try {
      const items = qAll('chatListItem');
      for (const item of items) {
        const id = peerIdOf(item);
        const titleEl = q('chatListItemTitle', item);
        const title = textOf(titleEl);
        const found = findClientForChat(this.mock.clients, { chatId: id, title });
        const t = found ? currentTicket(this.mock.tickets, found.client.id) : null;
        let state: BadgeState | null = null;
        if (t && t.status !== 'CLOSED') {
          state = isOverdue(t) ? 'overdue' : t.status === 'WAITING_CLIENT' ? 'waiting' : t.status === 'NEW' ? 'new' : 'open';
        }
        const existing = item.querySelector<HTMLElement>('[data-tp-badge]');
        if (!state) {
          existing?.remove();
          continue;
        }
        painted++;
        if (existing?.dataset.tpBadge === state) continue;
        const dot = existing ?? document.createElement('span');
        dot.setAttribute('data-tp-badge', state);
        dot.setAttribute('data-tp', '1');
        dot.title = `${TITLES[state]} ${t!.id}`;
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
