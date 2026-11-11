// Turns the relative-time mock JSON into absolute MockState, so SLA timers look "live"
// right after install / reset.
import staff from '../mock/staff.json';
import clients from '../mock/clients.json';
import rawTickets from '../mock/tickets.json';
import templates from '../mock/templates.json';
import kb from '../mock/kb.json';
import type { Client, KbArticle, MockState, Template, Ticket, TicketEvent, TicketStatus } from '../shared/types';

interface RawEvent { min: number; who: string; type: TicketEvent['type']; text: string }
interface RawTicket {
  id: string; clientId: string; title: string; status: string; assigneeId: string | null;
  createdMin: number; firstResponseMin: number | null; slaMin: number; closedMin: number | null;
  solutionNote: string | null; history: RawEvent[]; notes: string[];
}

const iso = (now: number, min: number) => new Date(now + min * 60_000).toISOString();

export function seedMockState(now = Date.now()): MockState {
  const tickets: Ticket[] = (rawTickets as RawTicket[]).map((t) => ({
    id: t.id,
    clientId: t.clientId,
    title: t.title,
    status: t.status as TicketStatus,
    assigneeId: t.assigneeId,
    createdAt: iso(now, t.createdMin),
    firstResponseAt: t.firstResponseMin == null ? null : iso(now, t.firstResponseMin),
    slaDeadline: iso(now, t.createdMin + t.slaMin),
    closedAt: t.closedMin == null ? null : iso(now, t.closedMin),
    solutionNote: t.solutionNote,
    history: t.history.map((h) => ({ at: iso(now, h.min), who: h.who, type: h.type, text: h.text })),
    notes: t.notes,
  }));
  return {
    staff,
    clients: clients as Client[],
    tickets,
    templates: templates as Template[],
    kb: kb as KbArticle[],
    favourites: ['t01', 't15'],
    usage: {},
    chatNotes: {},
    chatTags: {},
    reminders: [],
  };
}
