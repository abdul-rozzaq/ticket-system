// F6: put text into Telegram's composer. NEVER sends: no Enter key events, no send-button clicks.
import type { TgVersion } from '../shared/types';
import { closestOf, detectVersion, q, qAll, safe, warn } from './dom';
import { REPLY_LABELS } from './selectors';

export type StrategyId = 'execCommand' | 'inputEvent' | 'paste' | 'clipboard';
export const STRATEGIES: StrategyId[] = ['execCommand', 'inputEvent', 'paste', 'clipboard'];

export interface InsertOptions {
  /** Replace the whole composer content instead of inserting at the end. */
  replace?: boolean;
  /** Force one strategy (Diagnostics). */
  only?: StrategyId;
  /** Strategy to try first (remembered winner). */
  preferred?: string | null;
}

export interface AttemptResult {
  strategy: StrategyId;
  ok: boolean;
  note: string;
  ms: number;
}

export interface InsertResult {
  ok: boolean;
  winner: StrategyId | null;
  /** True when we only copied to the clipboard and the human must press Ctrl+V. */
  needsManualPaste: boolean;
  attempts: AttemptResult[];
  error?: string;
}

export function findComposer(version: TgVersion = detectVersion()): HTMLElement | null {
  const el = q<HTMLElement>('composer', document, version);
  if (el && el.isContentEditable) return el;
  return el;
}

/** Composer text, normalising Telegram's <br>/<div> line structure. */
export function composerText(el: HTMLElement): string {
  return (el.innerText ?? el.textContent ?? '').replace(/ /g, ' ').replace(/\n+$/, '');
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

function placeCaret(el: HTMLElement, replace: boolean) {
  el.focus();
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  if (!replace) range.collapse(false); // caret at the end
  sel.removeAllRanges();
  sel.addRange(range);
}

function caretToEnd(el: HTMLElement) {
  placeCaret(el, false);
}

/** Did the composer end up containing the text (and, for replace, only it)? */
function verify(el: HTMLElement, before: string, text: string, replace: boolean): boolean {
  const after = norm(composerText(el));
  const t = norm(text);
  if (replace) return after === t;
  return after !== norm(before) && after.endsWith(t);
}

function tryExecCommand(el: HTMLElement, text: string, replace: boolean): string {
  placeCaret(el, replace);
  if (replace && composerText(el)) document.execCommand('delete');
  // insertText handles "\n" in Chrome by inserting line breaks inside contenteditable.
  const r = document.execCommand('insertText', false, text);
  return r ? 'execCommand returned true' : 'execCommand returned false';
}

function tryInputEvent(el: HTMLElement, text: string, replace: boolean): string {
  placeCaret(el, replace);
  const before = new InputEvent('beforeinput', { inputType: 'insertText', data: text, bubbles: true, cancelable: true, composed: true });
  const notCancelled = el.dispatchEvent(before);
  // Synthetic beforeinput never mutates the DOM by itself. If the app did not handle it
  // (not cancelled), mutate the DOM ourselves and announce it with an input event.
  if (notCancelled) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const frag = document.createDocumentFragment();
      text.split('\n').forEach((line, i) => {
        if (i > 0) frag.appendChild(document.createElement('br'));
        frag.appendChild(document.createTextNode(line));
      });
      const last = frag.lastChild;
      range.insertNode(frag);
      if (last) {
        range.setStartAfter(last);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  }
  el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: text, bubbles: true, composed: true }));
  return notCancelled ? 'DOM mutated manually + input event' : 'beforeinput handled by Telegram';
}

function tryPaste(el: HTMLElement, text: string, replace: boolean): string {
  placeCaret(el, replace);
  const dt = new DataTransfer();
  dt.setData('text/plain', text);
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true });
  const notCancelled = el.dispatchEvent(ev);
  return notCancelled ? 'paste not handled by Telegram' : 'paste handled by Telegram';
}

async function tryClipboard(text: string): Promise<string> {
  try {
    await navigator.clipboard.writeText(text);
    return 'clipboard.writeText ok';
  } catch {
    // Fallback: hidden textarea + execCommand('copy'), allowed via clipboardWrite permission.
    const ta = document.createElement('textarea');
    ta.setAttribute('data-tp', '1');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) throw new Error('copy failed');
    return 'execCommand(copy) ok';
  }
}

/**
 * Insert text into the composer. Tries strategies in order (remembered winner first) and verifies
 * each by reading the composer text back. Leaves the caret at the end. Never sends.
 */
export async function insertIntoComposer(text: string, opts: InsertOptions = {}): Promise<InsertResult> {
  const attempts: AttemptResult[] = [];
  const el = findComposer();
  const replace = !!opts.replace;
  let order: StrategyId[] = opts.only ? [opts.only] : [...STRATEGIES];
  if (!opts.only && opts.preferred && STRATEGIES.includes(opts.preferred as StrategyId)) {
    order = [opts.preferred as StrategyId, ...order.filter((s) => s !== opts.preferred)];
    // Clipboard stays last: it is not a real insertion.
    order = [...order.filter((s) => s !== 'clipboard'), 'clipboard'];
  }

  for (const strategy of order) {
    const t0 = performance.now();
    if (strategy === 'clipboard') {
      try {
        const note = await tryClipboard(text);
        attempts.push({ strategy, ok: true, note, ms: performance.now() - t0 });
        el?.focus();
        return { ok: true, winner: 'clipboard', needsManualPaste: true, attempts };
      } catch (e) {
        attempts.push({ strategy, ok: false, note: String(e), ms: performance.now() - t0 });
        continue;
      }
    }
    if (!el) {
      attempts.push({ strategy, ok: false, note: 'composer topilmadi', ms: 0 });
      continue;
    }
    const before = composerText(el);
    let note = '';
    try {
      if (strategy === 'execCommand') note = tryExecCommand(el, text, replace);
      else if (strategy === 'inputEvent') note = tryInputEvent(el, text, replace);
      else note = tryPaste(el, text, replace);
    } catch (e) {
      note = `exception: ${String(e)}`;
    }
    // Let the framework re-render (Telegram may rewrite the DOM in a microtask/frame).
    await new Promise((r) => setTimeout(r, 30)); // let Telegram re-render; not rAF (paused in background tabs)
    const ok = verify(el, before, text, replace);
    attempts.push({ strategy, ok, note, ms: Math.round(performance.now() - t0) });
    if (ok) {
      caretToEnd(el);
      return { ok: true, winner: strategy, needsManualPaste: false, attempts };
    }
    // Undo partial garbage before the next strategy (e.g. half-inserted text).
    if (norm(composerText(el)) !== norm(before) && !replace) {
      safe('rollback', () => {
        placeCaret(el, true);
        document.execCommand('insertText', false, before);
      }, undefined);
    }
  }
  warn('all insertion strategies failed');
  return { ok: false, winner: null, needsManualPaste: false, attempts, error: 'Barcha usullar ishlamadi' };
}

/**
 * EXPERIMENTAL: start a reply to a given message bubble by opening Telegram's own context menu
 * and clicking its "Reply" item. Does not send anything.
 */
export async function replyToBubble(bubble: Element, version: TgVersion = detectVersion()): Promise<boolean> {
  try {
    const r = bubble.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + Math.min(20, r.height / 2), button: 2 };
    const target = (version === 'a' ? bubble.querySelector('.message-content') : bubble.querySelector('.bubble-content')) ?? bubble;
    target.dispatchEvent(new MouseEvent('contextmenu', opts));
    await new Promise((res) => setTimeout(res, 150));
    const items = qAll('contextMenuItem', document, version);
    const reply = items.find((i) => REPLY_LABELS.some((l) => (i.textContent ?? '').trim().toLowerCase().startsWith(l)));
    if (!reply) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return false;
    }
    (reply as HTMLElement).click();
    await new Promise((res) => setTimeout(res, 100));
    const c = findComposer(version);
    if (c) caretToEnd(c);
    return true;
  } catch (e) {
    warn('replyToBubble failed', e);
    return false;
  }
}

/** Is a node inside the composer (used by the inline trigger). */
export function isInComposer(node: Node | null): boolean {
  if (!node) return false;
  const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
  return !!closestOf(el, 'composer');
}
