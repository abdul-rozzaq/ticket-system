// F12: command palette (Ctrl+K / Alt+K). Searches tickets, templates, KB articles and actions.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Bridge } from './bridge';
import { insertWithToast, resolveCurrent, templateVars } from './context';
import { bus, toast, type AppState } from './hooks';
import type { ChatInfo } from '../shared/types';
import { applyVars } from '../logic/templates';
import { STATUS_LABEL } from '../logic/tickets';
import { ticketAction } from './tabs/TicketTab';
import { bumpUsage } from './tabs/TemplatesTab';
import { addReminder } from './tabs/RemindersTab';

interface Item { kind: string; label: string; hint?: string; run: () => void | Promise<unknown> }

const norm = (s: string) => s.toLowerCase().replace(/[ʻʼ`'’]/g, '');

export function Palette({ bridge, app, chat, onClose }: { bridge: Bridge; app: AppState; chat: ChatInfo | null; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const { client, ticket } = resolveCurrent(app, chat);
  const vars = templateVars(app, client);
  const me = app.settings.me;

  const all = useMemo<Item[]>(() => {
    const items: Item[] = [];
    if (ticket && ticket.status !== 'CLOSED') {
      items.push({ kind: 'amal', label: 'Men olaman', hint: ticket.id, run: () => ticketAction('take', ticket.id, me) });
      items.push({ kind: 'amal', label: 'Kutilmoqda', hint: ticket.id, run: () => ticketAction('wait', ticket.id, me) });
      items.push({ kind: 'amal', label: "Hal bo'ldi", hint: `${ticket.id} (izohsiz)`, run: () => ticketAction('solve', ticket.id, me) });
    }
    if (chat?.chatId) {
      items.push({ kind: 'amal', label: "Eslatma qo'yish — 15 daqiqa", run: () => addReminder(chat, 15, '') });
      items.push({ kind: 'amal', label: "Eslatma qo'yish — 1 soat", run: () => addReminder(chat, 60, '') });
    }
    items.push({ kind: 'amal', label: 'AI javob (oxirgi xabarlar)', run: () => bus.emit({ type: 'tab', tab: 'ai' }) });
    items.push({ kind: 'amal', label: 'Diagnostika', run: () => bus.emit({ type: 'tab', tab: 'diag' }) });
    for (const t of app.mock.templates) {
      items.push({
        kind: 'shablon', label: t.title, hint: t.category,
        run: async () => { if (await insertWithToast(bridge, applyVars(t.body, vars))) bumpUsage(t.id); },
      });
    }
    for (const a of app.mock.kb) {
      items.push({ kind: 'baza', label: a.problem, hint: `${a.system} · ${a.lang}`, run: () => insertWithToast(bridge, a.solution) });
    }
    for (const t of app.mock.tickets) {
      const c = app.mock.clients.find((x) => x.id === t.clientId);
      items.push({
        kind: 'tiket', label: `${t.id} ${t.title}`, hint: `${c?.companyName ?? ''} · ${STATUS_LABEL[t.status]}`,
        run: () => (c?.telegramChatId ? bridge.navigate(c.telegramChatId) : toast("Bu mijoz chatga bog'lanmagan", 'warn')),
      });
    }
    return items;
  }, [app, chat]);

  const items = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) return all.slice(0, 40);
    return all.filter((i) => words.every((w) => norm(`${i.kind} ${i.label} ${i.hint ?? ''}`).includes(w))).slice(0, 40);
  }, [q, all]);

  const pick = async (i: Item | undefined) => {
    if (!i) return;
    onClose();
    try {
      await i.run();
    } catch (e) {
      toast(String(e), 'err');
    }
  };

  return (
    <div class="tp-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="tp-palette">
        <input
          ref={inputRef}
          value={q}
          placeholder="Tiket, shablon, maqola yoki amal…"
          onInput={(e) => { setQ((e.target as HTMLInputElement).value); setSel(0); }}
          onKeyDown={(e) => {
            e.stopPropagation(); // keep Telegram's shortcuts out
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); pick(items[sel]); }
            else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          }}
        />
        <div class="items">
          {items.map((i, idx) => (
            <div class={`item ${idx === sel ? 'sel' : ''}`} onMouseMove={() => idx !== sel && setSel(idx)} onClick={() => pick(i)}>
              <span class="kind">{i.kind}</span>
              <span>{i.label}</span>
              {i.hint && <span class="tp-small tp-muted">{i.hint}</span>}
            </div>
          ))}
          {!items.length && <div class="item tp-muted">Hech narsa topilmadi</div>}
        </div>
      </div>
    </div>
  );
}
