// F17: mini stats from mock tickets.
import { usePanel } from '../context';
import { useNow } from '../hooks';
import { computeStats } from '../../logic/stats';
import { isOverdue } from '../../logic/sla';
import { STATUS_LABEL } from '../../logic/tickets';

export function StatsTab() {
  const { app } = usePanel();
  const now = useNow(15_000);
  const s = computeStats(app.mock, now);
  const overdue = app.mock.tickets.filter((t) => isOverdue(t, now));
  return (
    <div>
      <div class="tp-stat tp-section">
        <div class="tp-card"><div class="n">{s.open}</div><div class="tp-small tp-muted">ochiq tiketlar</div></div>
        <div class="tp-card"><div class="n" style={{ color: s.overdue ? 'var(--tp-err)' : undefined }}>{s.overdue}</div><div class="tp-small tp-muted">SLA o'tgan</div></div>
        <div class="tp-card"><div class="n">{s.waiting}</div><div class="tp-small tp-muted">mijoz kutilmoqda</div></div>
        <div class="tp-card"><div class="n">{s.avgFirstResponseMin ?? '—'}<span class="tp-small"> daq</span></div><div class="tp-small tp-muted">o'rtacha birinchi javob</div></div>
      </div>
      <div class="tp-section">
        <h4>Xodimlar</h4>
        <table class="tp-table">
          <thead><tr><th>Xodim</th><th>Ochiq</th><th>Bugun yopgan</th></tr></thead>
          <tbody>
            {s.openByStaff.map((o, i) => (
              <tr><td>{o.name}</td><td>{o.count}</td><td>{s.closedTodayByStaff[i].count}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {overdue.length > 0 && (
        <div class="tp-section">
          <h4>SLA o'tganlar</h4>
          <ul class="tp-list">
            {overdue.map((t) => (
              <li class="tp-small">
                <span class="tp-mono">{t.id}</span> · {app.mock.clients.find((c) => c.id === t.clientId)?.companyName} · {STATUS_LABEL[t.status]}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div class="tp-small tp-muted">Raqamlar mock ma'lumotlardan hisoblangan.</div>
    </div>
  );
}
