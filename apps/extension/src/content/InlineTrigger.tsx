// F5 inline trigger: typing ";query" in the composer opens a template autocomplete.
// Arrow keys + Enter/Tab pick, Esc closes. Enter is swallowed (capture phase) so Telegram does not send.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { AppState } from '../ui/hooks';

import type { ChatInfo, Template } from '../shared/types';
import { applyVars, searchTemplates } from '../logic/templates';
import { resolveCurrent, templateVars, insertWithToast } from '../ui/context';
import { bumpUsage } from '../ui/tabs/TemplatesTab';
import { findComposer, isInComposer, composerText } from '../telegram/composer';
import { q, warn } from '../telegram/dom';
import { localBridge } from './localBridge';
import { setHealth } from './health';

const TRIGGER_RE = /(?:^|\s);([^\s;]{0,30})$/;

/** Text between the start of the caret's text node and the caret. */
function textBeforeCaret(): string | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  if (!isInComposer(r.startContainer)) return null;
  const node = r.startContainer;
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').slice(0, r.startOffset);
  // Caret between element children: take the text of the preceding child.
  const prev = node.childNodes[r.startOffset - 1];
  return prev?.textContent ?? '';
}

export function InlineTrigger({ app, chat }: { app: AppState; chat: ChatInfo | null }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const [pos, setPos] = useState({ left: 0, bottom: 0 });
  const state = useRef({ open, list: [] as Template[], sel, query });

  const list = open ? searchTemplates(app.mock.templates, query, { favourites: app.mock.favourites, usage: app.mock.usage }).slice(0, 8) : [];
  state.current = { open, list, sel, query };

  const { client } = resolveCurrent(app, chat);
  const vars = templateVars(app, client);
  const varsRef = useRef(vars);
  varsRef.current = vars;

  const pick = async (t: Template) => {
    setOpen(false);
    const body = applyVars(t.body, varsRef.current);
    const len = state.current.query.length + 1; // ";" + query
    const composer = findComposer();
    try {
      composer?.focus();
      const s = window.getSelection();
      const before = composer ? composerText(composer) : '';
      for (let i = 0; i < len; i++) s?.modify('extend', 'backward', 'character');
      const ok = document.execCommand('insertText', false, body);
      const after = composer ? composerText(composer) : '';
      if (ok && after !== before && after.includes(body.slice(0, 20))) {
        setHealth('F5', 'OK', ";-trigger: execCommand o'rnini almashtirdi");
        bumpUsage(t.id);
        return;
      }
      // Fallback: remove the trigger text, then use the generic insertion pipeline.
      document.execCommand('delete');
      setHealth('F5', 'DEGRADED', ';-trigger: fallback insert');
    } catch (e) {
      warn('inline pick failed', e);
    }
    if (await insertWithToast(localBridge, body)) bumpUsage(t.id);
  };
  const pickRef = useRef(pick);
  pickRef.current = pick;

  useEffect(() => {
    const onInput = (e: Event) => {
      if (!isInComposer(e.target as Node)) return;
      const before = textBeforeCaret();
      const m = before != null ? TRIGGER_RE.exec(before) : null;
      if (!m) {
        if (state.current.open) setOpen(false);
        return;
      }
      const wrap = q('composerWrapper') ?? findComposer();
      const rect = wrap?.getBoundingClientRect();
      if (rect) setPos({ left: Math.max(8, rect.left), bottom: Math.max(8, innerHeight - rect.top + 6) });
      setQuery(m[1]);
      setSel(0);
      setOpen(true);
    };
    const onKey = (e: KeyboardEvent) => {
      const st = state.current;
      if (!st.open || !isInComposer(e.target as Node)) return;
      const stop = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
      };
      if (e.key === 'ArrowDown') { stop(); setSel((s) => Math.min(s + 1, st.list.length - 1)); }
      else if (e.key === 'ArrowUp') { stop(); setSel((s) => Math.max(s - 1, 0)); }
      else if (e.key === 'Escape') { stop(); setOpen(false); }
      else if (e.key === 'Enter' || e.key === 'Tab') {
        stop(); // never let Telegram send while the popup is open
        const t = st.list[st.sel];
        if (t) pickRef.current(t);
        else setOpen(false);
      }
    };
    const onBlur = () => setTimeout(() => {
      if (!isInComposer(document.activeElement)) setOpen(false);
    }, 200);
    window.addEventListener('input', onInput, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('focusout', onBlur, true);
    return () => {
      window.removeEventListener('input', onInput, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('focusout', onBlur, true);
    };
  }, []);

  if (!open) return null;
  return (
    <div class="tp-popup" style={{ left: `${pos.left}px`, bottom: `${pos.bottom}px` }} onMouseDown={(e) => e.preventDefault()}>
      <div class="tp-small tp-muted" style={{ padding: '2px 6px' }}>
        ;{query} — ↑↓ tanlash, Enter qo'yish, Esc yopish
      </div>
      {list.map((t, i) => (
        <div class={`tp-tpl ${i === sel ? 'sel' : ''}`} onMouseMove={() => i !== sel && setSel(i)} onClick={() => pick(t)}>
          <div class="t">{t.title} <span class="tp-small tp-muted">{t.category}</span></div>
          <div class="b">{applyVars(t.body, vars)}</div>
        </div>
      ))}
      {!list.length && <div class="tp-muted" style={{ padding: '6px' }}>Topilmadi</div>}
    </div>
  );
}

