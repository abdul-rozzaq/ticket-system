// The panel content, shared by the injected dock (F2) and the Chrome side panel (F15).
import { useEffect, useState } from 'preact/hooks';
import type { Bridge } from './bridge';
import { Ctx, resolveCurrent } from './context';
import { bus, useAppState, useBus, useIntentReplay } from './hooks';
import type { ChatInfo } from '../shared/types';
import { patchSettings } from '../shared/storage';
import { TicketTab } from './tabs/TicketTab';
import { TemplatesTab } from './tabs/TemplatesTab';
import { AiTab } from './tabs/AiTab';
import { RemindersTab } from './tabs/RemindersTab';
import { StatsTab } from './tabs/StatsTab';
import { DiagTab } from './tabs/DiagTab';
import { ServerTicketTab } from './tabs/ServerTicketTab';
import { ServerTemplatesTab } from './tabs/ServerTemplatesTab';
import { ServerAiTab } from './tabs/ServerAiTab';
import { useChatTicket, useServerStatus } from './server';
import { useRealtime } from './rt';

const TABS: { id: string; label: string; flag?: string }[] = [
  { id: 'ticket', label: 'Tiket', flag: 'F3' },
  { id: 'templates', label: 'Shablonlar', flag: 'F5' },
  { id: 'ai', label: 'AI', flag: 'F9' },
  { id: 'reminders', label: 'Eslatma', flag: 'F14' },
  { id: 'stats', label: 'Statistika', flag: 'F17' },
  { id: 'diag', label: 'Diagnostika' },
];

const KIND_LABEL: Record<string, string> = {
  private: 'shaxsiy', group: 'guruh', channel: 'kanal', 'forum-topic': 'forum mavzusi', unknown: "noma'lum",
};

export function Panel({ bridge }: { bridge: Bridge }) {
  const app = useAppState();
  const [chat, setChat] = useState<ChatInfo | null>(null);
  const [tab, setTab] = useState<string | null>(null);

  useEffect(() => bridge.subscribeChat(setChat), [bridge]);
  useBus((e) => {
    if (e.type === 'tab') setTab(e.tab);
    if (e.type === 'ai') setTab('ai');
  });

  // ".ai" typed in Telegram: the server delivers the draft; show it in the AI tab
  useRealtime((event, payload) => {
    if (event !== 'draft.ready') return;
    setTab('ai');
    // the tab may mount only after this tick: re-announce once it exists
    const fire = () => window.dispatchEvent(new CustomEvent('tp-draft-ready', { detail: payload }));
    fire();
    setTimeout(fire, 300);
  }, []);

  useIntentReplay('ai', 'panel-ai', () => setTab('ai'));
  useIntentReplay('tab', 'panel-tab', (e) => e.type === 'tab' && setTab(e.tab));

  const serverState = useServerStatus();
  const srvChat = useChatTicket(serverState?.connected ? (chat?.chatId ?? null) : null);

  if (!app || !serverState) return <div class="tp-body tp-muted">Yuklanmoqda…</div>;
  const flags = app.settings.flags;
  const serverMode = serverState.connected;
  // Server mode shows live data; the local-only Stats tab (mock numbers) is hidden there.
  const visible = TABS.filter((t) => (!t.flag || flags[t.flag]) && !(serverMode && t.id === 'stats'));
  const active = visible.find((t) => t.id === (tab ?? app.settings.dock.tab)) ?? visible[0];
  const choose = (id: string) => {
    setTab(id);
    if (bridge.mode === 'dock') patchSettings({ dock: { ...app.settings.dock, tab: id } });
  };
  const { client, by } = resolveCurrent(app, chat);
  const zoom = Math.min(200, Math.max(50, app.settings.uiZoom ?? 100));
  const setZoom = (z: number) => patchSettings({ uiZoom: Math.min(200, Math.max(50, Math.round(z / 5) * 5)) });

  return (
    <Ctx.Provider value={{ bridge, app, chat, server: serverState }}>
      <div class="tp-panel" style={{ zoom: String(zoom / 100) }}>
        {flags.F1 && (
          <div class="tp-chatline">
            {chat?.chatId || chat?.title ? (
              <>
                <b>{chat.title ?? '(nom topilmadi)'}</b> · {KIND_LABEL[chat.kind]} · <span class="tp-mono">{chat.chatId ?? '?'}</span>
                {chat.topicId && <> · mavzu {chat.topicId}</>}
                {serverMode ? (
                  srvChat.data ? <> · ✓ {srvChat.data.group.companyName}</> : <> · <i>mijoz guruhi emas</i></>
                ) : client ? (
                  <> · ✓ {client.companyName} <span class="tp-small">({by === 'id' ? 'ID' : 'nom'} bo'yicha)</span></>
                ) : (
                  <> · <i>mijozga bog'lanmagan</i></>
                )}
              </>
            ) : (
              <i>Chat ochilmagan</i>
            )}
          </div>
        )}
        <div class="tp-row" style={{ justifyContent: 'flex-end', padding: '2px 8px', gap: '4px' }}>
          <span class="tp-small tp-muted">Zoom</span>
          <button class="tp-btn small" title="Kichraytirish" onClick={() => setZoom(zoom - 10)}>−</button>
          <button class="tp-btn small" title="Asl holatga (100%)" onClick={() => setZoom(100)}>{zoom}%</button>
          <button class="tp-btn small" title="Kattalashtirish" onClick={() => setZoom(zoom + 10)}>+</button>
        </div>
        <div class="tp-tabs">
          {visible.map((t) => (
            <button class={`tp-tab ${t.id === active.id ? 'active' : ''}`} onClick={() => choose(t.id)}>
              {t.label}
            </button>
          ))}
          {flags.F12 && (
            <button class="tp-tab" title="Buyruqlar palitrasi (Ctrl+K / Alt+K)" onClick={() => bus.emit({ type: 'palette' })}>
              ⌘
            </button>
          )}
        </div>
        <div class="tp-body">
          {!serverMode && (
            <div class="tp-small tp-muted tp-section">
              Mock rejim: serverga ulanmagan. Haqiqiy tiketlar uchun Sozlamalarda serverga kiring.
            </div>
          )}
          {active.id === 'ticket' && (serverMode ? <ServerTicketTab /> : <TicketTab />)}
          {active.id === 'templates' && (serverMode ? <ServerTemplatesTab /> : <TemplatesTab />)}
          {active.id === 'ai' && (serverMode ? <ServerAiTab /> : <AiTab />)}
          {active.id === 'reminders' && <RemindersTab />}
          {active.id === 'stats' && <StatsTab />}
          {active.id === 'diag' && <DiagTab />}
        </div>
      </div>
    </Ctx.Provider>
  );
}
