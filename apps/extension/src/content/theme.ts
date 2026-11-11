// Follow Telegram's light/dark theme. Markers first, then background luminance as a fallback.
import { DARK_MARKERS } from '../telegram/selectors';
import { detectVersion } from '../telegram/dom';

export function isDark(): boolean {
  const v = detectVersion() === 'a' ? 'a' : 'k';
  if (DARK_MARKERS[v].some((s) => document.querySelector(s))) return true;
  try {
    const bg = getComputedStyle(document.body).backgroundColor;
    const m = bg.match(/\d+/g);
    if (m && m.length >= 3) {
      const [r, g, b] = m.map(Number);
      if (!(m.length === 4 && Number(m[3]) === 0)) return 0.2126 * r + 0.7152 * g + 0.0722 * b < 100;
    }
  } catch {
    /* ignore */
  }
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

export function watchTheme(cb: (dark: boolean) => void): () => void {
  let last = isDark();
  cb(last);
  const check = () => {
    const d = isDark();
    if (d !== last) cb((last = d));
  };
  const obs = new MutationObserver(check);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
  obs.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', check);
  return () => {
    obs.disconnect();
    mq.removeEventListener('change', check);
  };
}
