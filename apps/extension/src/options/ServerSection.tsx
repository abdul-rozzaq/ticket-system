// Options: connect the extension to the ticket server (login / logout). Credentials are sent once to the background
// worker, which keeps only the tokens; the password is never stored.
import { useState } from 'preact/hooks';
import { send } from '../shared/messages';
import { normalizeBaseUrl, type LoginResult } from '../server/session';
import { useServerStatus } from '../ui/server';

const LAST_URL = 'tp_last_server_url';

export function ServerSection() {
  const st = useServerStatus();
  const [url, setUrl] = useState(() => {
    try {
      return localStorage.getItem(LAST_URL) ?? 'http://localhost:3000';
    } catch {
      return 'http://localhost:3000';
    }
  });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  if (!st) return null;

  const login = async (e: Event) => {
    e.preventDefault();
    setMsg('');
    const base = normalizeBaseUrl(url);
    if (!base) return setMsg("Server manzili noto'g'ri (https://… yoki http://localhost:…)");
    setBusy(true);
    try {
      // Host permission must be requested from a user gesture (this submit).
      const origin = `${new URL(base).protocol}//${new URL(base).hostname}/*`;
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (!granted) return setMsg('Server manziliga ruxsat berilmadi');
      const r = await send<LoginResult>({ type: 'TP_SRV_LOGIN', baseUrl: base, username: username.trim(), password });
      if (!r.ok) return setMsg(r.error);
      try {
        localStorage.setItem(LAST_URL, base);
      } catch {
        /* optional convenience */
      }
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="tp-section tp-card">
      <h4>Tiket serveri</h4>
      {st.connected && st.user ? (
        <div class="tp-col">
          <div>
            ✅ Ulangan: <b>{st.user.displayName}</b> ({st.user.role === 'ADMIN' ? 'admin' : 'xodim'}) · <span class="tp-mono">{st.baseUrl}</span>
          </div>
          <div class="tp-small tp-muted">
            Panel haqiqiy tiketlar, shablonlar va AI qoralamalarni serverdan oladi. AI kalitlari faqat serverda saqlanadi.
          </div>
          <div>
            <button class="tp-btn small" onClick={() => send({ type: 'TP_SRV_LOGOUT' })}>Chiqish</button>
          </div>
        </div>
      ) : (
        <form class="tp-col" onSubmit={login}>
          <div class="tp-small tp-muted">Ulanmagan: panel ishlamaydi. Login admin panelda yaratiladi.</div>
          <label>Server manzili <input class="tp-mono" value={url} onInput={(e) => setUrl((e.target as HTMLInputElement).value)} required /></label>
          <label>Login <input value={username} autoComplete="username" onInput={(e) => setUsername((e.target as HTMLInputElement).value)} required /></label>
          <label>Parol <input type="password" value={password} autoComplete="current-password" onInput={(e) => setPassword((e.target as HTMLInputElement).value)} required /></label>
          {msg && <div class="tp-warnbox">{msg}</div>}
          <div>
            <button class="tp-btn small primary" type="submit" disabled={busy}>{busy ? '…' : 'Kirish'}</button>
          </div>
        </form>
      )}
    </section>
  );
}
