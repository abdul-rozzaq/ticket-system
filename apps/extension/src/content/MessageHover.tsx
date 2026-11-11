// F8: a floating "TP" button over the hovered message bubble, with a small action menu.
// Implemented with ONE delegated mouseover listener + an overlay positioned from getBoundingClientRect(),
// instead of injecting a button into every bubble with a MutationObserver: no work happens while
// scrolling, and Telegram's virtualised list never sees our nodes.
import { useEffect, useRef, useState } from 'preact/hooks';
import { bus } from '../ui/hooks';
import { bubbleFromEvent, parseBubble, messageIdOf } from '../telegram/messages';
import { replyToBubble } from '../telegram/composer';
import { detectVersion, rafThrottle } from '../telegram/dom';
import { setHealth } from './health';

export function MessageHover({ host, onAction }: { host: Element; onAction: () => void }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [menu, setMenu] = useState(false);
  const bubbleRef = useRef<Element | null>(null);
  const menuRef = useRef(false);
  menuRef.current = menu;

  useEffect(() => {
    const onOver = rafThrottle((e: MouseEvent) => {
      if (menuRef.current) return;
      if (e.target === host || host.contains(e.target as Node)) return; // over our own overlay
      const b = bubbleFromEvent(e.target);
      if (b === bubbleRef.current) return;
      bubbleRef.current = b;
      setRect(b ? b.getBoundingClientRect() : null);
      if (b) setHealth('F8', 'OK', 'xabar ustida tugma chiqdi');
    });
    const hide = () => {
      if (menuRef.current) return;
      bubbleRef.current = null;
      setRect(null);
    };
    document.addEventListener('mouseover', onOver, { passive: true });
    document.addEventListener('scroll', hide, { passive: true, capture: true });
    return () => {
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('scroll', hide, { capture: true });
    };
  }, [host]);

  if (!rect) return null;
  const close = () => {
    setMenu(false);
    setRect(null);
    bubbleRef.current = null;
  };
  const withBubble = (fn: (b: Element) => void | Promise<void>) => async () => {
    const b = bubbleRef.current;
    close();
    if (b) await fn(b);
  };
  const top = Math.max(4, rect.top + 2);
  const left = Math.min(innerWidth - 40, rect.right - 34);

  return (
    <>
      <button class="tp-hoverbtn" style={{ top: `${top}px`, left: `${left}px` }} onClick={() => setMenu(!menu)}>TP</button>
      {menu && (
        <div class="tp-menu" style={{ top: `${top + 22}px`, left: `${Math.max(8, left - 200)}px` }} onMouseLeave={close}>
          <button
            onClick={withBubble((b) => {
              const m = parseBubble(b);
              onAction();
              bus.emit({ type: 'ai', text: m?.text ?? '', messageId: m?.id ?? messageIdOf(b, detectVersion()) });
            })}
          >
            🤖 Shu xabar bo'yicha AI javob
          </button>
          <button
            onClick={withBubble((b) => {
              const m = parseBubble(b);
              onAction();
              bus.emit({ type: 'tab', tab: 'ticket' });
              setTimeout(() => bus.emit({ type: 'note', text: `«${(m?.text ?? '').slice(0, 300)}»` }), 50);
            })}
          >
            📌 Tiketga izoh qilish
          </button>
          <button
            onClick={withBubble(async (b) => {
              const ok = await replyToBubble(b);
              setHealth('F8', ok ? 'OK' : 'DEGRADED', ok ? 'reply menyusi ishladi' : 'reply menyusi topilmadi');
              onAction();
              bus.emit({ type: 'tab', tab: 'templates' });
            })}
          >
            💬 Shablon bilan javob
          </button>
        </div>
      )}
    </>
  );
}
