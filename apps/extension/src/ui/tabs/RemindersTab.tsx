// F14: per-chat reminders via chrome.alarms (background) + notifications.
import { useState } from 'preact/hooks';
import { usePanel } from '../context';
import { toast } from '../hooks';
import { updateMock } from '../../shared/storage';
import { send } from '../../shared/messages';
import type { ChatInfo } from '../../shared/types';

export async function addReminder(chat: ChatInfo, minutes: number, text: string) {
  if (!chat.chatId) {
    toast("Chat ID yo'q — eslatma qo'yib bo'lmaydi", 'err');
    return;
  }
  const r = {
    id: Math.random().toString(36).slice(2, 10),
    chatId: chat.chatId,
    chatTitle: chat.title ?? chat.chatId,
    at: new Date(Date.now() + minutes * 60_000).toISOString(),
    text,
  };
  await updateMock((m) => ({ ...m, reminders: [...m.reminders, r] }));
  await send({ type: 'TP_REMINDER_SYNC' }).catch(() => undefined);
  toast(`Eslatma ${minutes} daqiqadan keyin`);
}

export function RemindersTab() {
  const { app, chat } = usePanel();
  const [custom, setCustom] = useState('30');
  const [text, setText] = useState('');
  const list = [...app.mock.reminders].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <div>
      <div class="tp-section">
        <h4>Shu chat uchun eslatma qo'yish</h4>
        <input value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} placeholder="Izoh (ixtiyoriy)" />
        <div class="tp-row" style={{ marginTop: '6px' }}>
          <button class="tp-btn small" disabled={!chat?.chatId} onClick={() => addReminder(chat!, 15, text)}>15 daqiqa</button>
          <button class="tp-btn small" disabled={!chat?.chatId} onClick={() => addReminder(chat!, 60, text)}>1 soat</button>
          <input style={{ width: '60px' }} type="number" min="1" value={custom} onInput={(e) => setCustom((e.target as HTMLInputElement).value)} />
          <button class="tp-btn small" disabled={!chat?.chatId || !(Number(custom) > 0)} onClick={() => addReminder(chat!, Number(custom), text)}>daqiqa</button>
        </div>
        <div class="tp-small tp-muted" style={{ marginTop: '4px' }}>
          Bildirishnoma bosilganda Telegram yorlig'i ochiladi va chatga o'tiladi (URL hash orqali — tajribaviy).
        </div>
      </div>
      <div class="tp-section">
        <h4>Rejalashtirilgan ({list.length})</h4>
        <ul class="tp-list">
          {list.map((r) => (
            <li class="tp-row between tp-small">
              <span>
                <b>{new Date(r.at).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}</b> · {r.chatTitle}
                {r.text && <span class="tp-muted"> — {r.text}</span>}
              </span>
              <button class="tp-iconbtn" onClick={() => updateMock((m) => ({ ...m, reminders: m.reminders.filter((x) => x.id !== r.id) }))}>×</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
