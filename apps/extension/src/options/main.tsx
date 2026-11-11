// Options page: identity, panel mode, feature flags, chat mapping, LLM settings, export/import (F18).
import { render } from 'preact';
import { useState } from 'preact/hooks';
import css from '../ui/styles.css?inline';
import { FEATURES } from '../shared/features';
import { KEYS, mergeSettings, resetMock, setMock, setSettings, updateMock, defaultDiag } from '../shared/storage';
import { useAppState } from '../ui/hooks';
import { send, type LlmResponse } from '../shared/messages';
import type { LlmSettings, MockState, Settings } from '../shared/types';
import { ServerSection } from './ServerSection';

function originPattern(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

function App() {
  const app = useAppState();
  const [msg, setMsg] = useState('');
  const [llmTest, setLlmTest] = useState('');
  if (!app) return <div>Yuklanmoqda…</div>;
  const { settings, mock } = app;
  const save = (p: Partial<Settings>) => setSettings({ ...settings, ...p });
  const saveLlm = (p: Partial<LlmSettings>) => save({ llm: { ...settings.llm, ...p } });
  const flash = (t: string) => {
    setMsg(t);
    setTimeout(() => setMsg(''), 3000);
  };

  const exportAll = async () => {
    const all = await chrome.storage.local.get([KEYS.settings, KEYS.mock]);
    const s = all[KEYS.settings] as Settings | undefined;
    const data = {
      format: 'tp-assistant-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      // The API key is never exported.
      settings: s ? { ...s, llm: { ...s.llm, apiKey: '' } } : undefined,
      mock: all[KEYS.mock],
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tp-assistant-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const importAll = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      if (data?.format !== 'tp-assistant-export') throw new Error("Noto'g'ri fayl formati");
      const m = data.mock as MockState | undefined;
      if (m && (!Array.isArray(m.tickets) || !Array.isArray(m.clients))) throw new Error('mock buzilgan');
      if (data.settings) await setSettings(mergeSettings({ ...data.settings, llm: { ...data.settings.llm, apiKey: settings.llm.apiKey } }));
      if (m) await setMock(m);
      flash('Import qilindi');
    } catch (e) {
      flash(`Import xatosi: ${String(e)}`);
    }
  };

  const enableLlmHost = async () => {
    const pattern = originPattern(settings.llm.provider === 'anthropic' ? settings.llm.endpoint || 'https://api.anthropic.com' : settings.llm.endpoint);
    if (!pattern) return flash("Endpoint URL noto'g'ri");
    const ok = await chrome.permissions.request({ origins: [pattern] });
    flash(ok ? `Ruxsat berildi: ${pattern}` : 'Ruxsat berilmadi');
  };

  return (
    <div class="tp-root" data-theme={matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'} style={{ maxWidth: '820px', margin: '20px auto', padding: '0 16px' }}>
      <h2>TP Assistant — Sozlamalar</h2>
      {msg && <div class="tp-warnbox">{msg}</div>}

      <ServerSection />

      <section class="tp-section tp-card">
        <h4>Men kimman</h4>
        <div class="tp-row">
          {mock.staff.map((s) => (
            <label class="tp-row" style={{ gap: '4px' }}>
              <input type="radio" style={{ width: 'auto' }} checked={settings.me === s.id} onChange={() => save({ me: s.id })} /> {s.name}
            </label>
          ))}
        </div>
      </section>

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
        <div class="tp-small tp-muted">Chrome yon paneli brauzer zoomiga bo'ysunmaydi, shuning uchun zoom shu yerda (va panelning o'zida −/+). Har bir brauzerda alohida saqlanadi.</div>
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
                <td><input type="checkbox" style={{ width: 'auto' }} checked={!!settings.flags[f.id]} onChange={(e) => save({ flags: { ...settings.flags, [f.id]: (e.target as HTMLInputElement).checked } })} /></td>
                <td class="tp-mono">{f.id}</td>
                <td><b>{f.name}</b><div class="tp-small tp-muted">{f.description}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
        <label class="tp-row" style={{ gap: '4px', marginTop: '6px' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={settings.approveMaskBeforeAi} onChange={(e) => save({ approveMaskBeforeAi: (e.target as HTMLInputElement).checked })} />
          Maxfiy ma'lumot topilsa, AI'ga yuborishdan oldin tasdiqlashni so'rash (F13)
        </label>
      </section>

      <section class="tp-section tp-card">
        <h4>Mock mijozlar ↔ Telegram chatlari</h4>
        <div class="tp-small tp-muted">Chat ID — Telegram Web URL'dagi # dan keyingi qism (masalan -1001234567890 yoki @username). Panelda "Bog'lash" tugmasi ham bor.</div>
        <table class="tp-table">
          <thead><tr><th>Kompaniya</th><th>Tizim</th><th>telegramChatId</th><th>Nom bo'yicha (fallback)</th></tr></thead>
          <tbody>
            {mock.clients.map((c) => (
              <tr>
                <td>{c.companyName}</td>
                <td>{c.system}</td>
                <td><input class="tp-mono" value={c.telegramChatId} onChange={(e) => updateMock((m) => ({ ...m, clients: m.clients.map((x) => (x.id === c.id ? { ...x, telegramChatId: (e.target as HTMLInputElement).value.trim() } : x)) }))} /></td>
                <td><input value={c.titleHint} onChange={(e) => updateMock((m) => ({ ...m, clients: m.clients.map((x) => (x.id === c.id ? { ...x, titleHint: (e.target as HTMLInputElement).value.trim().toLowerCase() } : x)) }))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section class="tp-section tp-card">
        <h4>Haqiqiy LLM (F9) — standart holatda o'chiq</h4>
        <div class="tp-warnbox">Yoqilganda mijoz xabari (maskalangan) va bazadagi maqolalar tanlangan API'ga yuboriladi. Kalit faqat shu brauzerda saqlanadi va eksport qilinmaydi.</div>
        <div class="tp-col" style={{ marginTop: '6px' }}>
          <label>Provayder
            <select value={settings.llm.provider} onChange={(e) => {
              const provider = (e.target as HTMLSelectElement).value as LlmSettings['provider'];
              saveLlm(provider === 'anthropic' ? { provider, endpoint: 'https://api.anthropic.com', model: 'claude-opus-5-5' } : { provider, endpoint: 'https://api.openai.com/v1' });
            }}>
              <option value="anthropic">Anthropic Messages API</option>
              <option value="openai">OpenAI-mos endpoint (/chat/completions)</option>
            </select>
          </label>
          <label>Endpoint <input class="tp-mono" value={settings.llm.endpoint} onChange={(e) => saveLlm({ endpoint: (e.target as HTMLInputElement).value.trim() })} /></label>
          <label>Model <input class="tp-mono" value={settings.llm.model} onChange={(e) => saveLlm({ model: (e.target as HTMLInputElement).value.trim() })} /></label>
          <label>API kalit <input type="password" class="tp-mono" value={settings.llm.apiKey} onChange={(e) => saveLlm({ apiKey: (e.target as HTMLInputElement).value.trim() })} /></label>
          <div class="tp-row">
            <button class="tp-btn small" onClick={enableLlmHost}>1) Hostga ruxsat berish</button>
            <button class="tp-btn small" onClick={async () => {
              setLlmTest('…');
              const r = await send<LlmResponse>({ type: 'TP_LLM_TEST', llm: settings.llm });
              setLlmTest(r.ok ? `OK: "${r.text.slice(0, 40)}" · ${r.ms} ms · ${r.inputTokens}/${r.outputTokens} token` : `Xato: ${r.error}`);
            }}>2) Ulanishni tekshirish</button>
            <span class="tp-small">{llmTest}</span>
          </div>
          <div class="tp-small tp-muted">So'ng yuqoridagi "Funksiyalar" ro'yxatida F9_LLM ni yoqing.</div>
        </div>
      </section>

      <section class="tp-section tp-card">
        <h4>Eksport / import (F18)</h4>
        {settings.flags.F18 ? (
          <div class="tp-row">
            <button class="tp-btn small" onClick={exportAll}>JSON eksport</button>
            <label class="tp-btn small">JSON import<input type="file" accept="application/json" style={{ display: 'none' }} onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) importAll(f); }} /></label>
            <button class="tp-btn small" onClick={async () => { if (confirm("Mock ma'lumotlar boshlang'ich holatga qaytarilsinmi? (tiketlar, izohlar, eslatmalar)")) { await resetMock(); flash('Mock tiklandi'); } }}>Mock'ni tiklash</button>
            <button class="tp-btn small" onClick={async () => { await chrome.storage.local.set({ [KEYS.diag]: defaultDiag() }); flash('Diagnostika tozalandi'); }}>Diagnostikani tozalash</button>
          </div>
        ) : (
          <div class="tp-muted">F18 o'chirilgan.</div>
        )}
      </section>
      <div class="tp-small tp-muted">TP Assistant v{chrome.runtime.getManifest().version} — prototip, mock ma'lumotlar.</div>
    </div>
  );
}

const style = document.createElement('style');
style.textContent = `${css}\nbody{margin:0;background:#f4f5f7}@media (prefers-color-scheme: dark){body{background:#181818}}`;
document.head.appendChild(style);
const root = document.getElementById('app')!;
render(<App />, root);
