// F15: the same Panel rendered in chrome.sidePanel, talking to the content script via messaging.
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import css from '../ui/styles.css?inline';
import { Panel } from '../ui/Panel';
import { Palette } from '../ui/Palette';
import { bus, useAppState, useBus } from '../ui/hooks';
import { NO_TAB_ERROR, type Bridge } from '../ui/bridge';
import type { BridgeMethod, Msg } from '../shared/messages';
import type { ChatInfo } from '../shared/types';

async function telegramTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id != null && tab.url?.startsWith('https://web.telegram.org/') ? tab.id : null;
}

async function call<T>(method: BridgeMethod, ...args: unknown[]): Promise<T> {
  const tabId = await telegramTabId();
  if (tabId == null) throw new Error(NO_TAB_ERROR);
  const res = (await chrome.tabs.sendMessage(tabId, { type: 'TP_BRIDGE', method, args } satisfies Msg)) as { result?: T; __error?: string } | undefined;
  if (!res) throw new Error("Kontent skript javob bermadi — Telegram yorlig'ini yangilang");
  if (res.__error) throw new Error(res.__error);
  return res.result as T;
}

const remoteBridge: Bridge = {
  mode: 'sidepanel',
  getChat: () => call('getChat'),
  subscribeChat(cb) {
    const refresh = () => call<ChatInfo>('getChat').then(cb).catch(() => cb(null));
    const onMsg = (msg: Msg) => {
      if (msg.type === 'TP_CHAT') refresh(); // re-ask: the push may come from a background tab
    };
    chrome.runtime.onMessage.addListener(onMsg);
    chrome.tabs.onActivated.addListener(refresh);
    const onUpdated = (_id: number, info: chrome.tabs.OnUpdatedInfo) => info.url && refresh();
    chrome.tabs.onUpdated.addListener(onUpdated);
    refresh();
    return () => {
      chrome.runtime.onMessage.removeListener(onMsg);
      chrome.tabs.onActivated.removeListener(refresh);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  },
  insert: (text, opts) => call('insert', text, opts ?? {}),
  readMessages: (n) => call('readMessages', n),
  selfTest: () => call('selfTest'),
  domReport: () => call('domReport'),
  testInsert: (s) => call('testInsert', s),
  health: () => call('health'),
  replyToMessage: (id) => call('replyToMessage', id),
  // Copy from the side panel document itself (it has focus when the user clicks here).
  copy: async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  },
  navigate: (id) => call('navigate', id),
};

function App() {
  const app = useAppState();
  const [chat, setChat] = useState<ChatInfo | null>(null);
  const [palette, setPalette] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; text: string; kind: string }[]>([]);
  const [dark, setDark] = useState(matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => remoteBridge.subscribeChat(setChat), []);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const l = () => setDark(mq.matches);
    mq.addEventListener('change', l);
    return () => mq.removeEventListener('change', l);
  }, []);
  // UI events forwarded from the page (hover menu).
  useEffect(() => {
    const l = (msg: Msg) => {
      if (msg.type === 'TP_UI') bus.emit(msg.event);
    };
    chrome.runtime.onMessage.addListener(l);
    return () => chrome.runtime.onMessage.removeListener(l);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyK' && (e.ctrlKey || e.metaKey || e.altKey)) {
        e.preventDefault();
        setPalette(true);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  useBus((e) => {
    if (e.type === 'toast') {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, text: e.text, kind: e.kind ?? 'ok' }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
    }
    if (e.type === 'palette') setPalette(true);
  });

  return (
    <div class="tp-root" data-theme={dark ? 'dark' : 'light'} style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--tp-bg)' }}>
      {app && !app.settings.flags.F15 && <div class="tp-warnbox">F15 (yon panel) sozlamalarda o'chirilgan.</div>}
      {chat === null && <div class="tp-warnbox">Telegram Web (/k/ yoki /a/) yorlig'ini faol qiling. Kengaytma o'rnatilgandan keyin yorliqni yangilash kerak.</div>}
      <Panel bridge={remoteBridge} />
      {palette && app && <Palette bridge={remoteBridge} app={app} chat={chat} onClose={() => setPalette(false)} />}
      <div class="tp-toasts" style={{ bottom: '20px' }}>
        {toasts.map((t) => <div class={`tp-toast ${t.kind}`}>{t.text}</div>)}
      </div>
    </div>
  );
}

const style = document.createElement('style');
style.textContent = `${css}\nhtml,body{margin:0;padding:0;}`;
document.head.appendChild(style);
render(<App />, document.getElementById('app')!);
