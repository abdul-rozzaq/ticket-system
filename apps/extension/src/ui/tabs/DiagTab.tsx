// Diagnostika: version info, selector self-test, insertion test, parsed messages, DOM report, feature status.
import { useEffect, useState } from 'preact/hooks';
import { usePanel } from '../context';
import { toast } from '../hooks';
import { FEATURES } from '../../shared/features';
import type { ParsedMessage } from '../../shared/types';
import type { SelfTestRow } from '../../telegram/dom';
import type { InsertResult, StrategyId } from '../../telegram/composer';
import type { HealthEntry } from '../bridge';

function browserName(): string {
  const ua = navigator.userAgent;
  const m = /(Edg|OPR|YaBrowser|Chrome)\/([\d.]+)/.exec(ua);
  return m ? `${m[1] === 'Edg' ? 'Edge' : m[1] === 'OPR' ? 'Opera' : m[1]} ${m[2]}` : ua;
}

export function DiagTab() {
  const { bridge, app, chat } = usePanel();
  const [rows, setRows] = useState<SelfTestRow[] | null>(null);
  const [msgs, setMsgs] = useState<ParsedMessage[] | null>(null);
  const [ins, setIns] = useState<InsertResult[] | null>(null);
  const [health, setHealth] = useState<Record<string, HealthEntry>>({});
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      setRows(await bridge.selfTest());
      setHealth(await bridge.health());
      if (app.settings.flags.F7) setMsgs(await bridge.readMessages(15));
    } catch (e) {
      toast(String(e), 'err');
    }
  };
  useEffect(() => {
    refresh();
  }, [chat?.chatId, chat?.topicId]);

  const runInsert = async (s: StrategyId | 'all') => {
    setBusy(true);
    try {
      setIns(await bridge.testInsert(s));
      setHealth(await bridge.health());
    } catch (e) {
      toast(String(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const copyReport = async () => {
    const report = await bridge.domReport();
    const ok = await bridge.copy(report);
    toast(ok ? `Hisobot nusxalandi (${(report.length / 1024).toFixed(1)} KB)` : 'Nusxalab bo\'lmadi', ok ? 'ok' : 'err');
  };

  return (
    <div>
      <div class="tp-section">
        <h4>Muhit</h4>
        <div class="tp-small">
          Telegram: <b>/{chat?.version ?? '?'}/</b> · Brauzer: {browserName()} · Rejim: {bridge.mode} · Kengaytma v{chrome.runtime.getManifest().version}
        </div>
        <div class="tp-row" style={{ marginTop: '6px' }}>
          <button class="tp-btn small" onClick={refresh}>Yangilash</button>
          <button class="tp-btn small primary" onClick={copyReport}>DOM hisobotini nusxalash</button>
        </div>
      </div>

      <div class="tp-section">
        <h4>Funksiyalar holati</h4>
        <table class="tp-table">
          <tbody>
            {FEATURES.map((f) => {
              const on = app.settings.flags[f.id];
              const h = health[f.id];
              const status = !on ? 'OFF' : h?.status ?? 'NOT_TESTED';
              return (
                <tr>
                  <td class="tp-mono">{f.id}</td>
                  <td>{f.name}</td>
                  <td><span class={`tp-status ${status}`}>{status}</span></td>
                  <td class="tp-small tp-muted">{on ? h?.note ?? '' : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div class="tp-section">
        <h4>Test: yozish maydoniga matn qo'yish</h4>
        <div class="tp-warnbox">Test matni composerga qo'yiladi va keyin o'chiriladi. Hech narsa yuborilmaydi.</div>
        <div class="tp-row" style={{ marginTop: '6px' }}>
          <button class="tp-btn small primary" disabled={busy} onClick={() => runInsert('all')}>Barcha usullarni sinash</button>
          {(['execCommand', 'inputEvent', 'paste', 'clipboard'] as StrategyId[]).map((s) => (
            <button class="tp-btn small" disabled={busy} onClick={() => runInsert(s)}>{s}</button>
          ))}
        </div>
        <div class="tp-small tp-muted" style={{ marginTop: '4px' }}>
          Eslab qolingan g'olib: k={app.diag.insertWinner.k ?? '—'}, a={app.diag.insertWinner.a ?? '—'}
        </div>
        {ins && (
          <table class="tp-table" style={{ marginTop: '6px' }}>
            <tbody>
              {ins.map((r) =>
                r.attempts.map((a) => (
                  <tr>
                    <td class="tp-mono">{a.strategy}</td>
                    <td><span class={`tp-status ${a.ok ? 'OK' : 'FAILED'}`}>{a.ok ? 'ishladi' : "yo'q"}</span></td>
                    <td class="tp-small">{a.note} · {Math.round(a.ms)}ms</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        )}
      </div>

      <div class="tp-section">
        <h4>Selektorlar</h4>
        <table class="tp-table">
          <tbody>
            {(rows ?? []).map((r) => (
              <tr>
                <td>{r.label}</td>
                <td><span class={`tp-status ${r.state}`}>{r.state}{r.count > 1 ? ` ×${r.count}` : ''}</span></td>
                <td class="tp-mono" style={{ wordBreak: 'break-all' }}>{r.selector ?? r.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {app.settings.flags.F7 && (
        <div class="tp-section">
          <h4>F7: o'qilgan xabarlar ({msgs?.length ?? 0})</h4>
          <div class="tp-warnbox">Tajribaviy: faqat ekranda chizilgan xabarlar o'qiladi; Telegram yangilanganda buziladi.</div>
          <ul class="tp-list">
            {(msgs ?? []).map((m) => (
              <li class="tp-small">
                <span class="tp-mono">{m.id ?? '?'}</span> {m.outgoing ? '→' : '←'} <b>{m.sender ?? (m.outgoing ? 'biz' : '?')}</b>{' '}
                <span class="tp-muted">{m.time ?? ''}</span>
                {m.replyTo && <div class="tp-muted">↪ {m.replyTo}</div>}
                <div>{m.text.slice(0, 200)}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
