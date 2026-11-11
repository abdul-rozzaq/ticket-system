// F3 ticket card, F4 status actions, F16 notes & tags, chat → client mapping.
import { useState } from 'preact/hooks';
import { resolveCurrent, staffName, usePanel } from '../context';
import { bus, toast, useBus, useIntentReplay, useNow } from '../hooks';
import { slaInfo } from '../../logic/sla';
import { addTicketNote, assign, closeWithSolution, createTicket, mapChatToClient, setStatus, STATUS_LABEL, takeTicket } from '../../logic/tickets';
import { updateMock } from '../../shared/storage';
import type { SystemType, Ticket } from '../../shared/types';

export const systemClass = (s: SystemType) => (s === 'AmoCRM' ? 'amo' : s === 'Bitrix24' ? 'bitrix' : 'pbx');
const fmtTime = (iso: string) => new Date(iso).toLocaleString('uz-UZ', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });

export function SlaTimer({ t }: { t: Pick<Ticket, 'status' | 'slaDeadline'> }) {
  const now = useNow(1000);
  const s = slaInfo(t, now);
  return <span class={`tp-sla ${s.overdue ? 'overdue' : ''} ${s.paused ? 'paused' : ''}`}>⏱ {s.label}</span>;
}

/** Ticket actions are also used by the command palette. */
export async function ticketAction(action: 'take' | 'wait' | 'solve', ticketId: string, me: string, note = '') {
  await updateMock((m) =>
    action === 'take' ? takeTicket(m, ticketId, me) : action === 'wait' ? setStatus(m, ticketId, 'WAITING_CLIENT', me) : closeWithSolution(m, ticketId, note, me),
  );
}

export function TicketTab() {
  const { app, chat } = usePanel();
  const { client, ticket } = resolveCurrent(app, chat);
  const me = app.settings.me;
  const flags = app.settings.flags;
  const [closing, setClosing] = useState(false);
  const [solution, setSolution] = useState('');
  const [noteText, setNoteText] = useState('');
  const [tagText, setTagText] = useState('');
  const [mapTo, setMapTo] = useState('');
  const chatKey = chat?.chatId ?? chat?.title ?? '';

  useBus((e) => {
    if (e.type === 'note') setNoteText(e.text);
  });
  useIntentReplay('note', 'ticket-note', (e) => e.type === 'note' && setNoteText(e.text));

  const mapping = (
    <div class="tp-section">
      <h4>Chatni mock mijozga bog'lash</h4>
      <div class="tp-row">
        <select value={mapTo} onChange={(e) => setMapTo((e.target as HTMLSelectElement).value)} style={{ flex: 1 }}>
          <option value="">— mijozni tanlang —</option>
          {app.mock.clients.map((c) => (
            <option value={c.id}>{c.companyName} ({c.system})</option>
          ))}
        </select>
        <button
          class="tp-btn small primary"
          disabled={!mapTo || !chat?.chatId}
          onClick={async () => {
            await updateMock((m) => mapChatToClient(m, mapTo, chat!.chatId!));
            toast("Bog'landi");
          }}
        >
          Bog'lash
        </button>
      </div>
      {!chat?.chatId && <div class="tp-small tp-muted">Chat ID aniqlanmadi — URL'da #… bo'lishi kerak.</div>}
    </div>
  );

  if (!chat?.chatId && !chat?.title) return <div class="tp-muted">Telegram'da chatni oching.</div>;
  if (!client) return <div><div class="tp-muted tp-section">Bu chat hech bir mock mijozga bog'lanmagan.</div>{mapping}</div>;

  const notes = app.mock.chatNotes[chatKey] ?? [];
  const tags = app.mock.chatTags[chatKey] ?? [];

  return (
    <div>
      <div class="tp-card tp-section">
        <div class="tp-row between">
          <b>{client.companyName}</b>
          <span class={`tp-chip ${systemClass(client.system)}`}>{client.system}</span>
        </div>
        <div class="tp-small tp-muted">Kontakt: {client.contactName}</div>
        {ticket ? (
          <>
            <div class="tp-row between" style={{ marginTop: '6px' }}>
              <span class="tp-mono">{ticket.id}</span>
              <span class={`tp-chip st-${ticket.status}`}>{STATUS_LABEL[ticket.status]}</span>
            </div>
            <div style={{ marginTop: '4px' }}>{ticket.title}</div>
            <div class="tp-row between" style={{ marginTop: '4px' }}>
              <span class="tp-small">Mas'ul: <b>{staffName(app, ticket.assigneeId)}</b></span>
              <SlaTimer t={ticket} />
            </div>
            {ticket.solutionNote && <div class="tp-small" style={{ marginTop: '4px' }}>✅ Yechim: {ticket.solutionNote}</div>}
          </>
        ) : (
          <div class="tp-row" style={{ marginTop: '6px' }}>
            <span class="tp-muted">Tiket yo'q.</span>
            <button class="tp-btn small" onClick={() => updateMock((m) => createTicket(m, client.id, chat?.title ?? 'Yangi murojaat', me).state)}>
              Yangi tiket ochish
            </button>
          </div>
        )}
      </div>

      {ticket && flags.F4 && (
        <div class="tp-section">
          <div class="tp-row">
            <button class="tp-btn small primary" onClick={() => ticketAction('take', ticket.id, me)}>Men olaman</button>
            <button class="tp-btn small" onClick={() => ticketAction('wait', ticket.id, me)}>Kutilmoqda</button>
            <button class="tp-btn small ok" onClick={() => setClosing(true)}>Hal bo'ldi</button>
            <select
              style={{ width: 'auto' }}
              value={ticket.assigneeId ?? ''}
              onChange={(e) => updateMock((m) => assign(m, ticket.id, (e.target as HTMLSelectElement).value, me))}
              title="Qayta biriktirish"
            >
              <option value="" disabled>Biriktirish…</option>
              {app.mock.staff.map((s) => (
                <option value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          {closing && (
            <div class="tp-card" style={{ marginTop: '6px' }}>
              <div class="tp-small">Yechim izohi (bilim bazasi uchun):</div>
              <textarea value={solution} maxLength={500} onInput={(e) => setSolution((e.target as HTMLTextAreaElement).value)} placeholder="Masalan: webhook manzili http edi, https qilindi" />
              <div class="tp-row" style={{ marginTop: '6px' }}>
                <button
                  class="tp-btn small ok"
                  onClick={async () => {
                    await ticketAction('solve', ticket.id, me, solution);
                    setClosing(false);
                    setSolution('');
                    toast('Tiket yopildi');
                  }}
                >
                  Yopish
                </button>
                <button class="tp-btn small" onClick={() => setClosing(false)}>Bekor</button>
              </div>
            </div>
          )}
        </div>
      )}

      {ticket && (
        <div class="tp-section">
          <h4>Tarix</h4>
          <ul class="tp-list">
            {[...ticket.history].reverse().slice(0, 8).map((h) => (
              <li class="tp-small">
                <span class="tp-muted">{fmtTime(h.at)}</span> · <b>{staffName(app, h.who)}</b> · {h.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {flags.F16 && (
        <div class="tp-section">
          <h4>Ichki izohlar (mijozga yuborilmaydi)</h4>
          {ticket && ticket.notes.length > 0 && (
            <ul class="tp-list">
              {ticket.notes.map((n) => <li class="tp-small">📌 {n}</li>)}
            </ul>
          )}
          <ul class="tp-list">
            {notes.map((n) => (
              <li class="tp-small"><span class="tp-muted">{fmtTime(n.at)} {staffName(app, n.who)}:</span> {n.text}</li>
            ))}
          </ul>
          <textarea value={noteText} onInput={(e) => setNoteText((e.target as HTMLTextAreaElement).value)} placeholder="Izoh…" />
          <div class="tp-row" style={{ marginTop: '4px' }}>
            <button
              class="tp-btn small"
              disabled={!noteText.trim()}
              onClick={async () => {
                const text = noteText.trim();
                await updateMock((m) => {
                  const next = { ...m, chatNotes: { ...m.chatNotes, [chatKey]: [...(m.chatNotes[chatKey] ?? []), { text, at: new Date().toISOString(), who: me }] } };
                  return ticket ? addTicketNote(next, ticket.id, text, me) : next;
                });
                setNoteText('');
              }}
            >
              Izoh qo'shish
            </button>
          </div>
          <h4 style={{ marginTop: '10px' }}>Teglar</h4>
          <div class="tp-row">
            {tags.map((t) => (
              <span class="tp-chip">
                #{t}
                <button
                  class="tp-iconbtn"
                  style={{ padding: '0px' }}
                  onClick={() => updateMock((m) => ({ ...m, chatTags: { ...m.chatTags, [chatKey]: (m.chatTags[chatKey] ?? []).filter((x) => x !== t) } }))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <form
            class="tp-row"
            style={{ marginTop: '4px' }}
            onSubmit={async (e) => {
              e.preventDefault();
              const t = tagText.trim().replace(/^#/, '').toLowerCase();
              if (!t) return;
              await updateMock((m) => ({ ...m, chatTags: { ...m.chatTags, [chatKey]: Array.from(new Set([...(m.chatTags[chatKey] ?? []), t])) } }));
              setTagText('');
            }}
          >
            <input value={tagText} onInput={(e) => setTagText((e.target as HTMLInputElement).value)} placeholder="teg (Enter)" style={{ flex: 1 }} />
          </form>
        </div>
      )}

      <details class="tp-section">
        <summary class="tp-small tp-muted">Boshqa mijozga bog'lash</summary>
        {mapping}
      </details>
      <button class="tp-btn small" onClick={() => bus.emit({ type: 'tab', tab: 'templates' })}>Shablonlar →</button>
    </div>
  );
}
