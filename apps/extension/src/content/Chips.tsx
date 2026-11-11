// F10: suggestion chips above the composer, based on the latest incoming message.
import { useEffect, useState } from 'preact/hooks';
import type { AppState } from '../ui/hooks';
import type { ChatInfo } from '../shared/types';
import { applyVars } from '../logic/templates';
import { searchKb } from '../logic/ai';
import { insertWithToast, resolveCurrent, templateVars } from '../ui/context';
import { bumpUsage } from '../ui/tabs/TemplatesTab';
import { debounce, q, warn } from '../telegram/dom';
import { lastIncoming } from '../telegram/messages';
import { localBridge } from './localBridge';
import { setHealth } from './health';

interface Chip { key: string; label: string; text: string; templateId?: string }

const norm = (s: string) => s.toLowerCase().replace(/[ʻʼ`'’]/g, "'");

export function Chips({ app, chat }: { app: AppState; chat: ChatInfo | null }) {
  const [chips, setChips] = useState<Chip[]>([]);
  const [msgKey, setMsgKey] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const { client } = resolveCurrent(app, chat);
  const vars = templateVars(app, client);

  // Recompute suggestions when the message list changes (debounced; only childList mutations).
  useEffect(() => {
    let obs: MutationObserver | null = null;
    let observed: Element | null = null;
    const compute = () => {
      const last = lastIncoming(1)[0];
      if (!last) {
        setChips([]);
        return;
      }
      const key = `${chat?.chatId}:${last.id ?? last.text.slice(0, 40)}`;
      setMsgKey(key);
      const text = norm(last.text);
      const out: Chip[] = [];
      for (const t of app.mock.templates) {
        if (t.keywords.some((k) => k && text.includes(norm(k)))) out.push({ key: t.id, label: t.title, text: t.body, templateId: t.id });
        if (out.length >= 2) break;
      }
      const kb = searchKb(app.mock.kb, last.text, 1)[0];
      if (kb) out.push({ key: kb.article.id, label: kb.article.problem.slice(0, 40), text: kb.article.solution });
      setChips(out.slice(0, 3));
      setHealth('F10', 'OK', `${out.length} ta tavsiya`);
    };
    const debounced = debounce(compute, 600);
    const attach = () => {
      const list = q('messageList');
      if (list === observed) return;
      obs?.disconnect();
      observed = list;
      if (!list) return;
      obs = new MutationObserver(debounced);
      obs.observe(list, { childList: true, subtree: true });
    };
    attach();
    compute();
    const t = setInterval(attach, 2000);
    return () => {
      obs?.disconnect();
      clearInterval(t);
    };
  }, [chat?.chatId, chat?.topicId, app.mock.templates, app.mock.kb]);

  // Anchor above the composer; re-measured twice a second only while chips are visible.
  useEffect(() => {
    if (!chips.length) return;
    const measure = () => {
      try {
        const wrap = q('composerWrapper');
        const r = wrap?.getBoundingClientRect();
        setPos(r && r.width ? { left: r.left + 8, bottom: innerHeight - r.top + 4 } : null);
      } catch (e) {
        warn('chips measure failed', e);
      }
    };
    measure();
    const t = setInterval(measure, 500);
    return () => clearInterval(t);
  }, [chips.length]);

  if (!chips.length || !pos || dismissed === msgKey) return null;
  return (
    <div class="tp-chipbar" style={{ left: `${pos.left}px`, bottom: `${pos.bottom}px` }}>
      {chips.map((c) => (
        <button
          class="tp-chip"
          title={applyVars(c.text, vars)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={async () => {
            if ((await insertWithToast(localBridge, applyVars(c.text, vars))) && c.templateId) bumpUsage(c.templateId);
            setDismissed(msgKey);
          }}
        >
          💡 Tavsiya: {c.label}
        </button>
      ))}
      <button class="tp-chip" title="Yashirish" onClick={() => setDismissed(msgKey)}>×</button>
    </div>
  );
}
