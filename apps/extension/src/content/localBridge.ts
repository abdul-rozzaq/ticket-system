// Bridge implementation inside the content script (direct DOM access), plus the message
// handler that exposes the same methods to the side panel.
import type { Bridge } from '../ui/bridge';
import type { ChatInfo } from '../shared/types';
import type { BridgeMethod, Msg } from '../shared/messages';
import { ChatWatcher } from '../telegram/chat';
import { composerText, findComposer, insertIntoComposer, replyToBubble, STRATEGIES, type InsertResult, type StrategyId } from '../telegram/composer';
import { detectVersion, qAll, selfTest, warn } from '../telegram/dom';
import { messageIdOf, readMessages } from '../telegram/messages';
import { buildDomReport } from '../telegram/report';
import { getDiag, getSettings, patchDiag } from '../shared/storage';
import { getHealth, setHealth } from './health';

export const chatWatcher = new ChatWatcher();

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.setAttribute('data-tp', '1');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

function recordInsertHealth(r: InsertResult) {
  if (r.ok && !r.needsManualPaste) setHealth('F6', 'OK', `g'olib: ${r.winner}`);
  else if (r.ok) setHealth('F6', 'DEGRADED', 'faqat clipboard + Ctrl+V');
  else setHealth('F6', 'FAILED', r.error ?? '');
}

async function insert(text: string, opts: { replace?: boolean; only?: StrategyId } = {}): Promise<InsertResult> {
  const s = await getSettings();
  if (!s.flags.F6) {
    // F6 off: only clipboard.
    return insertIntoComposer(text, { only: 'clipboard' });
  }
  const v = detectVersion();
  const diag = await getDiag();
  const r = await insertIntoComposer(text, { ...opts, preferred: diag.insertWinner[v] ?? null });
  recordInsertHealth(r);
  if (r.ok && r.winner && r.winner !== 'clipboard' && diag.insertWinner[v] !== r.winner) {
    await patchDiag({ insertWinner: { ...diag.insertWinner, [v]: r.winner } });
  }
  return r;
}

/** Diagnostics: run strategies against the composer with a marker text and restore the previous text. */
async function testInsert(which: StrategyId | 'all'): Promise<InsertResult[]> {
  const el = findComposer();
  const before = el ? composerText(el) : '';
  const results: InsertResult[] = [];
  const list = which === 'all' ? STRATEGIES : [which];
  for (const s of list) {
    const marker = `TP test ${s} ${new Date().toLocaleTimeString()}`;
    const r = await insertIntoComposer(marker, { only: s, replace: true });
    results.push(r);
    // Restore whatever was there (plain text only; formatting is lost if there was any).
    const c = findComposer();
    if (c && s !== 'clipboard') {
      c.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(c);
      sel?.removeAllRanges();
      sel?.addRange(range);
      if (before) document.execCommand('insertText', false, before);
      else document.execCommand('delete');
    }
  }
  const v = detectVersion();
  const winner = results.find((r) => r.ok && r.winner !== 'clipboard')?.winner ?? null;
  const report = results.flatMap((r) => r.attempts.map((a) => `${a.strategy}: ${a.ok ? 'OK' : 'FAIL'} (${a.note}, ${Math.round(a.ms)}ms)`)).join('\n');
  const diag = await getDiag();
  await patchDiag({ lastInsertReport: report, insertWinner: winner ? { ...diag.insertWinner, [v]: winner } : diag.insertWinner });
  if (which === 'all') {
    if (winner) setHealth('F6', 'OK', `g'olib: ${winner}`);
    else if (results.some((r) => r.ok)) setHealth('F6', 'DEGRADED', 'faqat clipboard');
    else setHealth('F6', 'FAILED', el ? 'hech bir usul ishlamadi' : 'composer topilmadi');
  }
  return results;
}

async function replyToMessage(messageId: string | null): Promise<boolean> {
  const v = detectVersion();
  const bubbles = qAll('messageBubble', document, v);
  const target = messageId ? bubbles.find((b) => messageIdOf(b, v) === messageId) : bubbles[bubbles.length - 1];
  if (!target) return false;
  const ok = await replyToBubble(target, v);
  setHealth('F8', ok ? 'OK' : 'DEGRADED', ok ? 'reply menyusi ishladi' : "reply menyusi topilmadi");
  return ok;
}

export function navigateToChat(chatId: string) {
  // Both clients route on the URL hash. Changing it from the content script is the least invasive way.
  const target = `#${chatId}`;
  if (location.hash === target) return;
  location.hash = target;
  setTimeout(() => {
    const ok = chatWatcher.get().chatId === chatId;
    setHealth('F14', ok ? 'OK' : 'DEGRADED', ok ? "chatga o'tildi" : "hash o'zgardi, chat ochilmadi");
  }, 1500);
}

export const localBridge: Bridge = {
  mode: 'dock',
  getChat: async () => chatWatcher.get(),
  subscribeChat: (cb) => chatWatcher.subscribe(cb),
  insert,
  readMessages: async (n) => {
    const m = readMessages(n);
    setHealth('F7', m.length ? 'OK' : 'DEGRADED', `${m.length} ta xabar o'qildi`);
    return m;
  },
  selfTest: async () => selfTest(),
  domReport: async () => buildDomReport({ insertReport: (await getDiag()).lastInsertReport, extVersion: chrome.runtime.getManifest().version }),
  testInsert,
  health: async () => getHealth(),
  replyToMessage,
  copy: copyText,
  navigate: async (id) => navigateToChat(id),
};

/** Serve bridge calls coming from the side panel. */
export function installBridgeServer() {
  chrome.runtime.onMessage.addListener((msg: Msg, _sender, sendResponse) => {
    if (msg.type !== 'TP_BRIDGE') return false;
    const fn = (localBridge as unknown as Record<BridgeMethod, (...a: unknown[]) => Promise<unknown>>)[msg.method];
    if (typeof fn !== 'function') {
      sendResponse({ __error: `unknown method ${msg.method}` });
      return false;
    }
    fn(...msg.args)
      .then((r) => sendResponse({ result: r }))
      .catch((e) => {
        warn(`bridge ${msg.method} failed`, e);
        sendResponse({ __error: String(e) });
      });
    return true;
  });
  // Push chat changes to the side panel (ignored if nobody listens).
  chatWatcher.subscribe((chat: ChatInfo) => {
    chrome.runtime.sendMessage({ type: 'TP_CHAT', chat } satisfies Msg).catch(() => undefined);
  });
}
