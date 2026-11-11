// Background service worker: LLM calls (F9), reminders + notifications + badge (F14), side panel (F15).
import Anthropic from '@anthropic-ai/sdk';
import { getMock, getSettings, KEYS, patchDiag, updateMock } from '../shared/storage';
import type { LlmResponse, Msg } from '../shared/messages';
import type { LlmSettings } from '../shared/types';
import { isOverdue } from '../logic/sla';
import { Realtime } from './realtime';
import { createPingThrottle, SERVER_KEY, ServerClient, type ServerSession } from '../server/session';

// ---------- ticket server connection (tokens live only here and in chrome.storage.local) ----------
const server = new ServerClient({
  fetch: (...a) => fetch(...a),
  load: async () => ((await chrome.storage.local.get(SERVER_KEY))[SERVER_KEY] as ServerSession | undefined) ?? null,
  save: async (s) => {
    if (s) await chrome.storage.local.set({ [SERVER_KEY]: s });
    else await chrome.storage.local.remove(SERVER_KEY);
  },
  now: () => Date.now(),
});
const pingAllowed = createPingThrottle(5000);

// Realtime: forward server events to every Telegram tab (content script / dock) and to extension pages (side panel).
let badgeTimer: ReturnType<typeof setTimeout> | undefined;
const realtime = new Realtime(server, (event, payload) => {
  const msg: Msg = { type: 'TP_RT', event, payload };
  chrome.runtime.sendMessage(msg).catch(() => undefined); // extension pages; rejects when none is open
  void chrome.tabs.query({ url: ['https://web.telegram.org/k/*', 'https://web.telegram.org/a/*'] }).then((tabs) => {
    for (const t of tabs) if (t.id != null) chrome.tabs.sendMessage(t.id, msg).catch(() => undefined);
  });
  if (event === 'ticket.created' || event === 'ticket.updated') {
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => void refreshBadge(), 1500);
  }
  if (event === 'reminder' || event === 'sla.warning') void notifyServerEvent(event, payload as Record<string, unknown>);
});

async function notifyServerEvent(event: string, p: Record<string, unknown>) {
  const num = p.number != null ? `#${String(p.number)}` : '';
  const title = event === 'sla.warning' ? `SLA: ${num} muddati yaqin` : `Sizga tiket ${num} biriktirildi`;
  const message = typeof p.handoverNote === 'string' && p.handoverNote ? p.handoverNote : 'Telegram chatiga o‘ting';
  await chrome.notifications.create(`srv:${String(p.ticketId ?? Date.now())}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title,
    message,
    priority: 2,
  });
}

const TG_URLS = ['https://web.telegram.org/k/*', 'https://web.telegram.org/a/*'];

// ---------- side panel / action ----------
async function applyPanelBehavior() {
  const s = await getSettings();
  const useSide = s.panelMode === 'sidepanel' && s.flags.F15;
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: useSide });
  } catch (e) {
    console.warn('[TP] sidePanel.setPanelBehavior failed', e);
  }
  await syncAllSidePanels();
}

// The side panel is enabled per tab, only for Telegram Web. Globally it is disabled, so it never
// shows up on other pages (manifest has no side_panel.default_path on purpose).
const isTelegramUrl = (url?: string) => !!url && /^https:\/\/web\.telegram\.org\/(k|a)(\/|$|\?|#)/.test(url);

async function syncSidePanelForTab(tabId: number, url?: string) {
  try {
    if (isTelegramUrl(url)) await chrome.sidePanel.setOptions({ tabId, path: 'sidepanel.html', enabled: true });
    else await chrome.sidePanel.setOptions({ tabId, enabled: false });
  } catch (e) {
    console.warn('[TP] sidePanel.setOptions failed', e);
  }
}

async function syncAllSidePanels() {
  try {
    await chrome.sidePanel.setOptions({ enabled: false });
  } catch (e) {
    console.warn('[TP] sidePanel global disable failed', e);
  }
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) if (t.id != null) await syncSidePanelForTab(t.id, t.url);
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url || info.status === 'loading') void syncSidePanelForTab(tabId, info.url ?? tab.url);
});
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const t = await chrome.tabs.get(tabId).catch(() => null);
  if (t) void syncSidePanelForTab(tabId, t.url);
});

chrome.action.onClicked.addListener(async (tab) => {
  // Only fires when openPanelOnActionClick is false (dock mode).
  if (tab.id && tab.url?.startsWith('https://web.telegram.org/')) {
    chrome.tabs.sendMessage(tab.id, { type: 'TP_TOGGLE_DOCK' } satisfies Msg).catch(() => undefined);
  } else {
    chrome.runtime.openOptionsPage();
  }
});

// ---------- badge (overdue count) ----------
async function refreshBadge() {
  const [mock, s] = await Promise.all([getMock(), getSettings()]);
  if (!s.flags.F14) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  let n = mock.tickets.filter((t) => isOverdue(t)).length;
  if ((await server.status()).connected) {
    // server mode: the person's own overdue tickets (admins: all overdue)
    const r = await server.request<{ open: { overdue: number }; mine: { overdue: number } | null }>('stats/dashboard');
    n = r.ok ? (r.data.mine?.overdue ?? r.data.open.overdue) : 0;
  }
  await chrome.action.setBadgeBackgroundColor({ color: n ? '#e53935' : '#43a047' });
  await chrome.action.setBadgeText({ text: n ? String(n) : '' });
  await chrome.action.setTitle({ title: n ? `TP Assistant — ${n} ta tiket muddati o'tgan` : 'TP Assistant' });
}

// ---------- reminders ----------
async function syncReminderAlarms() {
  const mock = await getMock();
  const alarms = await chrome.alarms.getAll();
  const existing = new Set(alarms.filter((a) => a.name.startsWith('rem:')).map((a) => a.name));
  const wanted = new Set<string>();
  for (const r of mock.reminders) {
    const name = `rem:${r.id}`;
    wanted.add(name);
    if (!existing.has(name)) await chrome.alarms.create(name, { when: Math.max(Date.now() + 1000, new Date(r.at).getTime()) });
  }
  for (const name of existing) if (!wanted.has(name)) await chrome.alarms.clear(name);
}

async function fireReminder(id: string) {
  const mock = await getMock();
  const r = mock.reminders.find((x) => x.id === id);
  if (!r) return;
  await chrome.notifications.create(`rem:${r.id}:${r.chatId}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: `Eslatma: ${r.chatTitle}`,
    message: r.text || 'Chatga qaytish vaqti',
    priority: 2,
    requireInteraction: true,
  });
  await updateMock((m) => ({ ...m, reminders: m.reminders.filter((x) => x.id !== id) }));
}

async function focusTelegramChat(chatId: string | null) {
  const tabs = await chrome.tabs.query({ url: TG_URLS });
  const tab = tabs[0];
  if (!tab?.id) {
    await chrome.tabs.create({ url: `https://web.telegram.org/k/${chatId ? `#${chatId}` : ''}` });
    return;
  }
  await chrome.tabs.update(tab.id, { active: true });
  if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
  if (chatId) chrome.tabs.sendMessage(tab.id, { type: 'TP_NAVIGATE', chatId } satisfies Msg).catch(() => undefined);
}

chrome.notifications.onClicked.addListener((notifId) => {
  const m = /^rem:[^:]+:(.*)$/.exec(notifId);
  focusTelegramChat(m ? m[1] : null);
  chrome.notifications.clear(notifId);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'tp-badge') refreshBadge();
  else if (alarm.name.startsWith('rem:')) fireReminder(alarm.name.slice(4));
});

// ---------- LLM ----------
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-5', 'claude-fable-5-1']);

async function callLlm(llm: LlmSettings, system: string, user: string): Promise<LlmResponse> {
  const t0 = performance.now();
  const base: LlmResponse = { ok: false, text: '', ms: 0, inputTokens: null, outputTokens: null, model: llm.model, error: null };
  if (!llm.apiKey) return { ...base, error: "API kalit kiritilmagan (Sozlamalar)" };
  try {
    if (llm.provider === 'anthropic') {
      const client = new Anthropic({
        apiKey: llm.apiKey,
        baseURL: llm.endpoint || undefined,
        dangerouslyAllowBrowser: true, // key is the user's own, stored locally; requests go only to the configured host
        maxRetries: 1,
      });
      const params: Record<string, unknown> = {
        model: llm.model,
        max_tokens: 1024,
        system,
        output_config: { effort: 'low' },
        messages: [{ role: 'user', content: user }],
      };
      // Server-side refusal fallback (opt-in) for models that support it.
      if (FALLBACK_MODELS.has(llm.model)) {
        params.betas = ['server-side-fallback-2026-07-01'];
        params.fallbacks = 'default';
      }
      const res = (await client.beta.messages.create(params as never)) as unknown as Anthropic.Beta.BetaMessage;
      const text = res.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();
      if (res.stop_reason === 'refusal') return { ...base, ms: Math.round(performance.now() - t0), error: 'Model rad etdi (refusal)' };
      return {
        ok: true,
        text,
        ms: Math.round(performance.now() - t0),
        inputTokens: res.usage?.input_tokens ?? null,
        outputTokens: res.usage?.output_tokens ?? null,
        model: res.model,
        error: null,
      };
    }
    // OpenAI-compatible chat completions endpoint (user-requested alternative provider).
    const url = `${llm.endpoint.replace(/\/+$/, '')}/chat/completions`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${llm.apiKey}` },
      body: JSON.stringify({
        model: llm.model,
        max_tokens: 1024,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    const json = await r.json();
    if (!r.ok) return { ...base, ms: Math.round(performance.now() - t0), error: `${r.status}: ${JSON.stringify(json).slice(0, 300)}` };
    return {
      ok: true,
      text: String(json.choices?.[0]?.message?.content ?? '').trim(),
      ms: Math.round(performance.now() - t0),
      inputTokens: json.usage?.prompt_tokens ?? null,
      outputTokens: json.usage?.completion_tokens ?? null,
      model: json.model ?? llm.model,
      error: null,
    };
  } catch (e) {
    const err = e instanceof Anthropic.APIError ? `${e.status ?? ''} ${e.message}` : String(e);
    return { ...base, ms: Math.round(performance.now() - t0), error: err };
  }
}

// ---------- messaging ----------
chrome.runtime.onMessage.addListener((msg: Msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'TP_LLM': {
        const s = await getSettings();
        if (!s.flags.F9_LLM) return sendResponse({ ok: false, error: "Haqiqiy LLM o'chirilgan" });
        const res = await callLlm(s.llm, msg.system, msg.user);
        await patchDiag({ llmLast: { at: new Date().toISOString(), ms: res.ms, inputTokens: res.inputTokens, outputTokens: res.outputTokens, model: res.model, error: res.error } });
        return sendResponse(res);
      }
      case 'TP_LLM_TEST':
        return sendResponse(await callLlm(msg.llm, 'Reply with the single word OK.', 'ping'));
      case 'TP_SRV_LOGIN': {
        const r = await server.login(msg.baseUrl, msg.username, msg.password);
        if (r.ok) void refreshBadge();
        return sendResponse(r);
      }
      case 'TP_SRV_LOGOUT':
        await server.logout();
        void refreshBadge();
        return sendResponse(true);
      case 'TP_SRV_STATUS':
        return sendResponse(await server.status());
      case 'TP_API': {
        // Only paths of the public API: the service-token endpoints (internal/*) are never reachable from here.
        if (/^\/?internal(\/|$)/i.test(msg.path) || msg.path.includes('..'))
          return sendResponse({ ok: false, status: 400, code: 'BAD_PATH', error: "Ruxsat yo'q" });
        return sendResponse(await server.request(msg.path, { method: msg.method, body: msg.body }));
      }
      case 'TP_ACTIVITY': {
        if (!msg.chatId || !pingAllowed(msg.chatId)) return sendResponse(false);
        const r = await server.request('activity', { method: 'POST', body: { chatId: msg.chatId } });
        return sendResponse(r.ok);
      }
      case 'TP_REMINDER_SYNC':
        await syncReminderAlarms();
        return sendResponse(true);
      case 'TP_BADGE_REFRESH':
        await refreshBadge();
        return sendResponse(true);
      case 'TP_OPEN_SIDEPANEL': {
        try {
          if (sender.tab?.id) await chrome.sidePanel.open({ tabId: sender.tab.id });
          return sendResponse({ ok: true });
        } catch (e) {
          return sendResponse({ ok: false, error: String(e) });
        }
      }
      default:
        return sendResponse(undefined);
    }
  })().catch((e) => {
    console.warn('[TP] background handler failed', e);
    sendResponse({ ok: false, error: String(e) });
  });
  return true; // async response
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[KEYS.settings]) {
    applyPanelBehavior();
    refreshBadge();
  }
  if (changes[SERVER_KEY]) {
    void refreshBadge();
    void realtime.sync(); // login -> connect, logout -> disconnect, token refresh -> no-op (same server)
  }
  if (changes[KEYS.mock]) {
    refreshBadge();
    syncReminderAlarms();
  }
});

async function init() {
  await getMock(); // seeds on first run
  await applyPanelBehavior();
  await chrome.alarms.create('tp-badge', { periodInMinutes: 1 });
  await refreshBadge();
  await syncReminderAlarms();
  await realtime.sync();
}
void realtime.sync(); // the worker was woken up (message, alarm): make sure the channel is up
chrome.runtime.onInstalled.addListener(() => void init());
chrome.runtime.onStartup.addListener(() => void init());
