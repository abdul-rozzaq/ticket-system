// Options page: server login, panel mode, zoom, feature flags, diagnostics reset.
import { render } from 'preact';
import { useState } from 'preact/hooks';
import css from '../ui/styles.css?inline';
import { FEATURES } from '../shared/features';
import { KEYS, setSettings, defaultDiag } from '../shared/storage';
import { useAppState } from '../ui/hooks';
import type { Settings } from '../shared/types';
import { ServerSection } from './ServerSection';

function App() {
  const app = useAppState();
  const [msg, setMsg] = useState('');
  if (!app) return <div>Yuklanmoqda…</div>;
  const { settings } = app;
  const save = (p: Partial<Settings>) => setSettings({ ...settings, ...p });
  const flash = (t: string) => {
    setMsg(t);
    setTimeout(() => setMsg(''), 3000);
  };

  return (
    <div
      class="tp-root"
      data-theme={matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'}
      style={{ maxWidth: '820px', margin: '20px auto', padding: '0 16px' }}
    >
      <h2>TP Assistant — Sozlamalar</h2>
      {msg && <div class="tp-warnbox">{msg}</div>}

      <ServerSection />

      <section class="tp-section tp-card">
        <h4>Panel rejimi</h4>
        <label class="tp-row" style={{ gap: '4px' }}>
          <input type="radio" style={{ width: 'auto' }} checked={settings.panelMode === 'dock'} onChange={() => save({ panelMode: 'dock' })} />
          Telegram ichida (dock, Alt+T)
        </label>
        <label class="tp-row" style={{ gap: '4px' }}>
          <input type="radio" style={{ width: 'auto' }} checked={settings.panelMode === 'sidepanel'} onChange={() => save({ panelMode: 'sidepanel' })} />
          Chrome yon paneli (kengaytma ikonkasini bosing)
        </label>
        <button class="tp-btn small" onClick={() => save({ dock: { ...settings.dock, x: null, y: 80, w: 360, h: 560, collapsed: false } })}>
          Dock joylashuvini tiklash
        </button>
      </section>

      <section class="tp-section tp-card">
        <h4>Panel zoomi</h4>
        <div class="tp-small tp-muted">
          Chrome yon paneli brauzer zoomiga bo'ysunmaydi, shuning uchun zoom shu yerda (va panelning o'zida −/+). Har bir brauzerda alohida saqlanadi.
        </div>
        <div class="tp-row" style={{ marginTop: '6px' }}>
          <input type="range" min="50" max="200" step="5" style={{ flex: 1 }} value={settings.uiZoom} onInput={(e) => save({ uiZoom: Number((e.target as HTMLInputElement).value) })} />
          <b style={{ width: '48px' }}>{settings.uiZoom}%</b>
          <button class="tp-btn small" onClick={() => save({ uiZoom: 100 })}>100%</button>
        </div>
      </section>

      <section class="tp-section tp-card">
        <h4>Funksiyalar</h4>
        <table class="tp-table">
          <tbody>
            {FEATURES.map((f) => (
              <tr>
                <td>
                  <input
                    type="checkbox"
                    style={{ width: 'auto' }}
                    checked={!!settings.flags[f.id]}
                    onChange={(e) => save({ flags: { ...settings.flags, [f.id]: (e.target as HTMLInputElement).checked } })}
                  />
                </td>
                <td class="tp-mono">{f.id}</td>
                <td>
                  <b>{f.name}</b>
                  <div class="tp-small tp-muted">{f.description}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section class="tp-section tp-card">
        <h4>Diagnostika</h4>
        <button
          class="tp-btn small"
          onClick={async () => {
            await chrome.storage.local.set({ [KEYS.diag]: defaultDiag() });
            flash('Diagnostika tozalandi');
          }}
        >
          Diagnostikani tozalash
        </button>
      </section>
      <div class="tp-small tp-muted">TP Assistant v{chrome.runtime.getManifest().version}</div>
    </div>
  );
}

const style = document.createElement('style');
style.textContent = `${css}\nbody{margin:0;background:#f4f5f7}@media (prefers-color-scheme: dark){body{background:#181818}}`;
document.head.appendChild(style);
const root = document.getElementById('app')!;
render(<App />, root);
