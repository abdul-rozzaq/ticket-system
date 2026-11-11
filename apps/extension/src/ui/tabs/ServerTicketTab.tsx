// Server mode: ticket card of the open Telegram chat, status actions, internal notes. Data comes from the ticket server.
import { useState } from 'preact/hooks';
import { api } from '../../shared/messages';
import { usePanel } from '../context';
import { toast } from '../hooks';
import { useApi, useChatTicket, useTicketDetail } from '../server';
import { SlaTimer } from './TicketTab';
import { STATUS_LABEL } from '../../logic/tickets';
import { SYSTEM_LABEL, type SrvTicket } from '../../server/types';

const fmtTime = (iso: string) => new Date(iso).toLocaleString('uz-UZ', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
const sysClass = (s: string) => (s === 'AMOCRM' ? 'amo' : s === 'BITRIX24' ? 'bitrix' : 'pbx');

export function ServerTicketTab() {
  const { chat, server } = usePanel();
  const admin = server.user?.role === 'ADMIN';
  const chatId = chat?.chatId ?? null;
  const byChat = useChatTicket(chatId);
  const ticket: SrvTicket | null = byChat.data?.current ?? null;
  const detail = useTicketDetail(ticket?.id ?? null);
  const users = useApi<{ id: string; displayName: string; isActive: boolean }[]>(admin ? 'users' : null);
  const [closing, setClosing] = useState(false);
  const [solution, setSolution] = useState('');
  const [noteText, setNoteText] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    byChat.reload();
    detail.reload();
  };
  const act = async (path: string, body?: unknown, ok = 'Bajarildi') => {
    setBusy(true);
    const r = await api(path, { method: 'POST', body: body ?? {} });
    setBusy(false);
    if (r.ok) toast(ok);
    else toast(r.code === 'ALREADY_TAKEN' ? 'Boshqa xodim allaqachon oldi' : r.error, r.code === 'ALREADY_TAKEN' ? 'warn' : 'err');
    refresh();
    return r.ok;
  };

  if (!chatId) return <div class="tp-muted">Telegram'da chatni oching.</div>;
  if (byChat.loading && !byChat.data) return <div class="tp-muted">Yuklanmoqda…</div>;
  if (byChat.error?.status === 404)
    return (
      <div class="tp-muted tp-section">
        Bu chat mijoz guruhi sifatida ro'yxatdan o'tmagan. Admin panelda «Mijoz guruhlari» bo'limidan qo'shing yoki userbot topgan guruhni faollashtiring.
      </div>
    );
  if (byChat.error) return <div class="tp-warnbox">Server xatosi: {byChat.error.error}</div>;
  const group = byChat.data?.group;
  if (!group) return null;
  const last = byChat.data?.lastClosed;

  return (
    <div>
      <div class="tp-card tp-section">
        <div class="tp-row between">
          <b>{group.companyName}</b>
          <span class={`tp-chip ${sysClass(group.systemType)}`}>{SYSTEM_LABEL[group.systemType]}</span>
        </div>
        {!group.isActive && <div class="tp-small tp-warnbox">Guruh faol emas: yangi xabarlardan tiket ochilmaydi.</div>}
        {ticket ? (
          <>
            <div class="tp-row between" style={{ marginTop: '6px' }}>
              <span class="tp-mono">#{ticket.number}</span>
              <span class={`tp-chip st-${ticket.status}`}>{STATUS_LABEL[ticket.status]}</span>
            </div>
            <div style={{ marginTop: '4px' }}>{ticket.summary || '—'}</div>
            {ticket.needsReview && <div class="tp-small tp-warnbox">AI ishonchsiz: tekshiring</div>}
            <div class="tp-row between" style={{ marginTop: '4px' }}>
              <span class="tp-small">
                Mas'ul: <b>{ticket.assignee?.displayName ?? '—'}</b>
              </span>
              <SlaTimer t={ticket} />
            </div>
          </>
        ) : (
          <div class="tp-row" style={{ marginTop: '6px' }}>
            <span class="tp-muted">Ochiq tiket yo'q.</span>
            <button
              class="tp-btn small"
              disabled={busy}
              onClick={async () => {
                const ok = await act('tickets', { clientGroupId: group.id, text: chat?.title ? `${chat.title}: qo'lda ochildi` : "Qo'lda ochilgan murojaat" }, 'Tiket ochildi');
                if (ok) refresh();
              }}
            >
              Yangi tiket ochish
            </button>
          </div>
        )}
        {!ticket && last && (
          <div class="tp-small tp-muted" style={{ marginTop: '4px' }}>
            Oxirgi: #{last.number} · {last.solutionNote ? `✅ ${last.solutionNote}` : 'yopilgan'}
          </div>
        )}
      </div>

      {ticket && (
        <div class="tp-section">
          <div class="tp-row">
            <button class="tp-btn small primary" disabled={busy} onClick={() => act(`tickets/${ticket.id}/take`, undefined, 'Siz oldingiz')}>
              Men olaman
            </button>
            {ticket.status === 'WAITING_CLIENT' ? (
              <button class="tp-btn small" disabled={busy} onClick={() => act(`tickets/${ticket.id}/status`, { status: 'IN_PROGRESS' })}>Davom ettirish</button>
            ) : (
              <button class="tp-btn small" disabled={busy} onClick={() => act(`tickets/${ticket.id}/status`, { status: 'WAITING_CLIENT' })}>Kutilmoqda</button>
            )}
            <button class="tp-btn small ok" disabled={busy} onClick={() => setClosing(true)}>Hal bo'ldi</button>
            {admin && (
              <select
                style={{ width: 'auto' }}
                value=""
                title="Qayta biriktirish"
                onChange={(e) => {
                  const id = (e.target as HTMLSelectElement).value;
                  if (id) void act(`tickets/${ticket.id}/assign`, { assigneeId: id }, 'Biriktirildi');
                }}
              >
                <option value="">Biriktirish…</option>
                {(users.data ?? []).filter((u) => u.isActive).map((u) => (
                  <option value={u.id}>{u.displayName}</option>
                ))}
              </select>
            )}
          </div>
          {closing && (
            <div class="tp-card" style={{ marginTop: '6px' }}>
              <div class="tp-small">Yechim izohi (bilim bazasi uchun):</div>
              <textarea value={solution} maxLength={2000} onInput={(e) => setSolution((e.target as HTMLTextAreaElement).value)} placeholder="Masalan: webhook manzili http edi, https qilindi" />
              <div class="tp-row" style={{ marginTop: '6px' }}>
                <button
                  class="tp-btn small ok"
                  disabled={busy}
                  onClick={async () => {
                    if (await act(`tickets/${ticket.id}/close`, { solutionNote: solution.trim() || undefined }, 'Tiket yopildi')) {
                      setClosing(false);
                      setSolution('');
                    }
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

      {ticket && detail.data && (
        <>
          <div class="tp-section">
            <h4>Tarix</h4>
            <ul class="tp-list">
              {[...detail.data.events].reverse().slice(0, 8).map((e) => (
                <li class="tp-small">
                  <span class="tp-muted">{fmtTime(e.createdAt)}</span> · {e.type}
                </li>
              ))}
            </ul>
          </div>
          <div class="tp-section">
            <h4>Ichki izohlar (mijozga yuborilmaydi)</h4>
            <ul class="tp-list">
              {detail.data.messages.filter((m) => m.isInternalNote).map((m) => (
                <li class="tp-small">📌 <span class="tp-muted">{fmtTime(m.sentAt)}</span> {m.text}</li>
              ))}
            </ul>
            <textarea value={noteText} maxLength={2000} onInput={(e) => setNoteText((e.target as HTMLTextAreaElement).value)} placeholder="Izoh…" />
            <div class="tp-row" style={{ marginTop: '4px' }}>
              <button
                class="tp-btn small"
                disabled={!noteText.trim() || busy}
                onClick={async () => {
                  if (await act(`tickets/${ticket.id}/note`, { text: noteText.trim() }, 'Izoh qo\'shildi')) setNoteText('');
                }}
              >
                Izoh qo'shish
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
