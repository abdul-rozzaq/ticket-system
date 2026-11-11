// Content script entry. Everything we render lives in ONE shadow root attached to a fixed,
// zero-size host element, so Telegram's CSS and ours never collide.
import { render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import css from '../ui/styles.css?inline';
import { bus, useAppState, useBus, type AppState } from '../ui/hooks';
import { Palette } from '../ui/Palette';
import type { ChatInfo } from '../shared/types';
import { api, type Msg } from '../shared/messages';
import { isInComposer } from '../telegram/composer';
import { detectVersion, warn } from '../telegram/dom';
import { chatWatcher, installBridgeServer, localBridge, navigateToChat } from './localBridge';
import { Dock } from './Dock';
import { installActivityPing } from './activity';
import { InlineTrigger } from './InlineTrigger';
import { Chips } from './Chips';
import { MessageHover } from './MessageHover';
import { Badges, mockLookup, serverLookup, type OpenChat } from './badges';
import { useServerStatus } from '../ui/server';
import { isTicketEvent, onRealtime } from '../ui/rt';
import { watchTheme } from './theme';
import { setHealth } from './health';

declare global {
  interface Window { __tpAssistantLoaded?: boolean }
}

interface ToastItem { id: number; text: string; kind: string }

function Root({ host }: { host: HTMLElement }) {
  const app = useAppState();
  const [chat, setChat] = useState<ChatInfo | null>(null);
  const [dockVisible, setDockVisible] = useState(true);
  const [palette, setPalette] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [dark, setDark] = useState(false);

  useEffect(() => watchTheme(setDark), []);
  useEffect(() => chatWatcher.subscribe(setChat), []);
  // Tell the server who is sending (no-op unless logged in to a server; throttled in the background).
  useEffect(() => installActivityPing(() => chatWatcher.get().chatId), []);

  useBus((e) => {
    if (e.type === 'toast') {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, text: e.text, kind: e.kind ?? 'ok' }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
    }
    if (e.type === 'palette') setPalette(true);
  });

  const sidepanelMode = !!app && app.settings.panelMode === 'sidepanel' && app.settings.flags.F15;
  const dockEnabled = !!app && app.settings.flags.F2 && !sidepanelMode;

  // Forward hover-menu actions to the side panel when it is the active surface.
  useBus(
    (e) => {
      if (!sidepanelMode) return;
      if (e.type === 'ai' || e.type === 'note' || e.type === 'tab') {
        chrome.runtime.sendMessage({ type: 'TP_UI', event: e } satisfies Msg).catch(() => undefined);
      }
    },
    [sidepanelMode],
  );

  const openSidePanel = () => chrome.runtime.sendMessage({ type: 'TP_OPEN_SIDEPANEL' } satisfies Msg).catch(() => undefined);
  const showSurface = () => (sidepanelMode ? openSidePanel() : setDockVisible(true));

  // Keyboard: Alt+T toggles the dock; Ctrl+K (outside the composer) / Alt+K opens the palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyT') {
        e.preventDefault();
        e.stopPropagation();
        if (sidepanelMode) openSidePanel();
        else setDockVisible((v) => !v);
      } else if (app?.settings.flags.F12 && e.code === 'KeyK' && ((e.altKey && !e.ctrlKey) || ((e.ctrlKey || e.metaKey) && !e.altKey && !isInComposer(e.target as Node)))) {
        e.preventDefault();
        e.stopPropagation();
        setPalette(true);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [sidepanelMode, app?.settings.flags.F12]);

  // Messages from background (action click, notification click).
  useEffect(() => {
    const l = (msg: Msg) => {
      if (msg.type === 'TP_TOGGLE_DOCK') setDockVisible((v) => !v);
      if (msg.type === 'TP_NAVIGATE') navigateToChat(msg.chatId);
    };
    chrome.runtime.onMessage.addListener(l);
    return () => chrome.runtime.onMessage.removeListener(l);
  }, []);

  useBadges(app);

  useEffect(() => {
    if (!app) return;
    if (chat) setHealth('F1', chat.chatId && chat.title ? 'OK' : chat.chatId || chat.title ? 'DEGRADED' : 'NOT_TESTED', chat.chatId && chat.title ? `${chat.kind}` : !chat.chatId ? "ID URL'dan o'qilmadi" : 'nom topilmadi');
    setHealth('F2', dockEnabled ? 'OK' : 'NOT_TESTED', dockEnabled ? 'shadow DOM ichida chizildi' : '');
  }, [chat, dockEnabled, app]);

  if (!app) return null;
  const f = app.settings.flags;
  return (
    <div class="tp-root" data-theme={dark ? 'dark' : 'light'}>
      {dockEnabled && dockVisible && <Dock initial={app.settings.dock} onHide={() => setDockVisible(false)} />}
      {(dockEnabled && !dockVisible) || sidepanelMode ? (
        <button class="tp-launcher" title={sidepanelMode ? 'Yon panelni ochish (Alt+T)' : 'TP panel (Alt+T)'} onClick={showSurface}>TP</button>
      ) : null}
      {f.F5 && <InlineTrigger app={app} chat={chat} />}
      {f.F10 && <Chips app={app} chat={chat} />}
      {f.F8 && <MessageHover host={host} onAction={() => !sidepanelMode && setDockVisible(true)} />}
      {palette && f.F12 && <Palette bridge={localBridge} app={app} chat={chat} onClose={() => setPalette(false)} />}
      <div class="tp-toasts">
        {toasts.map((t) => (
          <div class={`tp-toast ${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </div>
  );
}

const badges = new Badges();
function useBadges(app: AppState | null) {
  const server = useServerStatus();
  const connected = !!server?.connected;
  const [rows, setRows] = useState<OpenChat[]>([]);

  // server mode: open tickets per chat, refreshed every 30 s and whenever the server reports a ticket change
  useEffect(() => {
    if (!connected) {
      setRows([]);
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const r = await api<OpenChat[]>('tickets/open-chats');
      if (alive && r.ok) setRows(r.data);
    };
    void load();
    const poll = setInterval(load, 30_000);
    const off = onRealtime((ev) => {
      if (!isTicketEvent(ev)) return;
      clearTimeout(timer);
      timer = setTimeout(load, 500);
    });
    return () => {
      alive = false;
      clearInterval(poll);
      clearTimeout(timer);
      off();
    };
  }, [connected]);

  const lookup = useMemo(
    () => (connected ? serverLookup(rows) : app ? mockLookup(app.mock) : null),
    [connected, rows, app?.mock],
  );
  const on = !!app?.settings.flags.F11 && !!lookup && server !== null;
  useEffect(() => {
    if (on && lookup) badges.start(lookup);
    else badges.stop();
  }, [on]);
  useEffect(() => {
    if (lookup) badges.update(lookup);
  }, [lookup]);
}

function boot() {
  if (window.__tpAssistantLoaded) return;
  window.__tpAssistantLoaded = true;
  if (detectVersion() === 'unknown') return;
  try {
    const host = document.createElement('div');
    host.id = 'tp-assistant-host';
    host.setAttribute('data-tp', '1');
    // Zero-size fixed host: children are position:fixed overlays with pointer-events re-enabled.
    host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483000;pointer-events:none;';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = css;
    shadow.appendChild(style);
    const mount = document.createElement('div');
    shadow.appendChild(mount);
    document.documentElement.appendChild(host);
    // Stop our keystrokes (inputs inside the shadow root) from reaching Telegram's global shortcuts.
    for (const type of ['keydown', 'keyup', 'keypress'] as const) {
      shadow.addEventListener(type, (e) => e.stopPropagation());
    }
    chatWatcher.start();
    installBridgeServer();
    render(<Root host={host} />, mount);
    // Expose for manual debugging from DevTools (isolated world): no secrets in here.
    (window as unknown as Record<string, unknown>).__tp = { bus, chatWatcher };
    console.info('[TP] TP Assistant loaded on /' + detectVersion() + '/');
  } catch (e) {
    warn('boot failed', e);
  }
}

boot();
