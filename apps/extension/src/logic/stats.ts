// Mini dashboard numbers computed from mock tickets.
import type { MockState } from '../shared/types';
import { isOverdue } from './sla';

export interface StaffCount { staffId: string; name: string; count: number }
export interface Stats {
  open: number;
  overdue: number;
  waiting: number;
  avgFirstResponseMin: number | null;
  closedTodayByStaff: StaffCount[];
  openByStaff: StaffCount[];
}

export function computeStats(state: MockState, now = Date.now()): Stats {
  const open = state.tickets.filter((t) => t.status !== 'CLOSED');
  const frt = state.tickets
    .filter((t) => t.firstResponseAt)
    .map((t) => (new Date(t.firstResponseAt!).getTime() - new Date(t.createdAt).getTime()) / 60_000);
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const closedToday = state.tickets.filter((t) => t.closedAt && new Date(t.closedAt).getTime() >= startOfDay.getTime());
  return {
    open: open.length,
    overdue: open.filter((t) => isOverdue(t, now)).length,
    waiting: open.filter((t) => t.status === 'WAITING_CLIENT').length,
    avgFirstResponseMin: frt.length ? Math.round(frt.reduce((a, b) => a + b, 0) / frt.length) : null,
    closedTodayByStaff: state.staff.map((s) => ({ staffId: s.id, name: s.name, count: closedToday.filter((t) => t.assigneeId === s.id).length })),
    openByStaff: state.staff.map((s) => ({ staffId: s.id, name: s.name, count: open.filter((t) => t.assigneeId === s.id).length })),
  };
}
