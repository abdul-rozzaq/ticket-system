// The panel content, shared by the injected dock (F2) and the Chrome side panel (F15).
// Everything comes from the ticket server; without a login the panel only offers the login shortcut and diagnostics.
import { useEffect, useState } from 'preact/hooks';
import type { Bridge } from './bridge';
import { Ctx } from './context';
import { bus, useAppState, useBus, useIntentReplay } from './hooks';
import type { ChatInfo } from '../shared/types';
import { patchSettings } from '../shared/storage';
import { openOptions } from '../shared/messages';
import { DiagTab } from './tabs/DiagTab';
import { ServerTicketTab } from './tabs/ServerTicketTab';
import { ServerTemplatesTab } from './tabs/ServerTemplatesTab';
import { ServerAiTab } from './tabs/ServerAiTab';
import { useChatTicket, useServerStatus } from './server';
import { useRealtime } from './rt';

const TABS: { id: string; label: string; flag?: string; needsServer?: boolean }[] = [
  { id: 'ticket', label: 'Tiket', flag: 'F3', needsServer: true },
  { id: 'templates', label: 'Shablonlar', flag: 'F5', needsServer: true },
  { id: 'ai', label: 'AI', flag: 'F9', needsServer: true },
  { id: 'diag', label: 'Diagnostika' },
];

const KIND_LABEL: Record<string, string> = {
  private: 'shaxsiy',
  group: 'guruh',
  channel: 'kanal',
  'forum-topic': 'forum mavzusi',
  unknown: "noma'lum",
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

  const server = useServerStatus();
  const connected = !!server?.connected;
  const srvChat = useChatTicket(connected ? (chat?.chatId ?? null) : null);

  if (!app || !server) return <div class="tp-body tp-muted">Yuklanmoqda…</div>;
  const flags = app.settings.flags;
  const visible = TABS.filter((t) => (!t.flag || flags[t.flag]) && (connected || !t.needsServer));
  const active = visible.find((t) => t.id === (tab ?? app.settings.dock.tab)) ?? visible[0];
  const choose = (id: string) => {
    setTab(id);
    if (bridge.mode === 'dock') patchSettings({ dock: { ...app.settings.dock, tab: id } });
  };
  const zoom = Math.min(200, Math.max(50, app.settings.uiZoom ?? 100));
  const setZoom = (z: number) => patchSettings({ uiZoom: Math.min(200, Math.max(50, Math.round(z / 5) * 5)) });

  return (
    <Ctx.Provider value={{ bridge, app, chat, server }}>
      <div class="tp-panel" style={{ zoom: String(zoom / 100) }}>
        {flags.F1 && (
          <div class="tp-chatline">
            {chat?.chatId || chat?.title ? (
              <>
                <b>{chat.title ?? '(nom topilmadi)'}</b> · {KIND_LABEL[chat.kind]} · <span class="tp-mono">{chat.chatId ?? '?'}</span>
                {chat.topicId && <> · mavzu {chat.topicId}</>}
                {connected &&
                  (srvChat.data ? (
                    <> · ✓ {srvChat.data.group.companyName}</>
                  ) : (
                    <>
                      {' '}
                      · <i>mijoz guruhi emas</i>
                    </>
                  ))}
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
          {connected && flags.F12 && (
            <button class="tp-tab" title="Buyruqlar palitrasi (Ctrl+K / Alt+K)" onClick={() => bus.emit({ type: 'palette' })}>
              ⌘
            </button>
          )}
        </div>
        <div class="tp-body">
          {!connected && (
            <div class="tp-card tp-section">
              <b>Serverga kirilmagan</b>
              <div class="tp-small tp-muted" style={{ margin: '4px 0 8px' }}>
                Tiketlar, shablonlar va AI qoralamalar tiket serveridan olinadi. Sozlamalarda login qiling.
              </div>
              <button class="tp-btn small primary" onClick={() => void openOptions()}>Sozlamalarni ochish</button>
            </div>
          )}
          {connected && active.id === 'ticket' && <ServerTicketTab />}
          {connected && active.id === 'templates' && <ServerTemplatesTab />}
          {connected && active.id === 'ai' && <ServerAiTab />}
          {active.id === 'diag' && <DiagTab />}
        </div>
      </div>
    </Ctx.Provider>
  );
}
