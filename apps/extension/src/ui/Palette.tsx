// F12: command palette (Ctrl+K / Alt+K). Searches the server's templates, knowledge base and own open tickets, plus actions.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Bridge } from './bridge';
import { insertWithToast } from './context';
import { bus, toast } from './hooks';
import { openOptions } from '../shared/messages';
import { bumpTemplateUsage, ticketAction, useApi, useTemplateData } from './server';
import type { ChatInfo } from '../shared/types';
import { applyVars } from '../logic/templates';
import { keyToWebId } from '../telegram/peer-key';
import { STATUS_LABEL, type SrvStatus } from '../server/types';

interface Item {
  kind: string;
  label: string;
  hint?: string;
  run: () => void | Promise<unknown>;
}
interface KbRow {
  id: string;
  problem: string;
  solution: string;
  systemType: string;
  lang: string;
}
interface TicketRow {
  id: string;
  number: number;
  summary: string;
  status: SrvStatus;
  clientGroup: { companyName: string; telegramChatId: string };
}

const norm = (s: string) => s.toLowerCase().replace(/[ʻʼ`'’]/g, '');

export function Palette({ bridge, chat, onClose }: { bridge: Bridge; chat: ChatInfo | null; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const { connected, templates, vars, ticket } = useTemplateData(chat?.chatId ?? null);
  const kb = useApi<{ items: KbRow[] }>(connected ? 'kb?status=APPROVED&pageSize=100' : null);
  const tickets = useApi<{ items: TicketRow[] }>(connected ? 'tickets?pageSize=50' : null);

  const all = useMemo<Item[]>(() => {
    const items: Item[] = [];
    if (!connected) {
      items.push({ kind: 'amal', label: 'Serverga kirish (Sozlamalar)', run: () => void openOptions() });
      return items;
    }
    if (ticket && ticket.status !== 'CLOSED') {
      const act = (a: 'take' | 'wait' | 'solve') => async () => {
        const r = await ticketAction(a, ticket.id);
        toast(r.ok ? 'Bajarildi' : r.error, r.ok ? 'ok' : 'err');
      };
      items.push({ kind: 'amal', label: 'Men olaman', hint: `#${ticket.number}`, run: act('take') });
      items.push({ kind: 'amal', label: 'Kutilmoqda', hint: `#${ticket.number}`, run: act('wait') });
      items.push({ kind: 'amal', label: "Hal bo'ldi", hint: `#${ticket.number} (izohsiz)`, run: act('solve') });
    }
    items.push({ kind: 'amal', label: 'AI javob', run: () => bus.emit({ type: 'tab', tab: 'ai' }) });
    items.push({ kind: 'amal', label: 'Diagnostika', run: () => bus.emit({ type: 'tab', tab: 'diag' }) });
    for (const t of templates) {
      items.push({
        kind: 'shablon',
        label: t.title,
        hint: t.category,
        run: async () => {
          if (await insertWithToast(bridge, applyVars(t.body, vars))) bumpTemplateUsage(t.id);
        },
      });
    }
    for (const a of kb.data?.items ?? []) {
      items.push({ kind: 'baza', label: a.problem, hint: `${a.systemType} · ${a.lang}`, run: () => insertWithToast(bridge, a.solution) });
    }
    for (const t of tickets.data?.items ?? []) {
      if (t.status === 'CLOSED') continue;
      const webId = keyToWebId(t.clientGroup.telegramChatId);
      items.push({
        kind: 'tiket',
        label: `#${t.number} ${t.summary || t.clientGroup.companyName}`,
        hint: `${t.clientGroup.companyName} · ${STATUS_LABEL[t.status]}`,
        run: () => (webId ? bridge.navigate(webId) : toast("Chat ID noma'lum", 'warn')),
      });
    }
    return items;
  }, [connected, ticket, templates, vars, kb.data, tickets.data, bridge]);

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
          onInput={(e) => {
            setQ((e.target as HTMLInputElement).value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            e.stopPropagation(); // keep Telegram's shortcuts out
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, items.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              pick(items[sel]);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
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
