// Pure ticket state transitions (mock). Each returns a new MockState.
import type { Client, MockState, Ticket, TicketStatus, ChatInfo } from '../shared/types';

const nowIso = (now: number) => new Date(now).toISOString();

export const STATUS_LABEL: Record<TicketStatus, string> = {
  NEW: 'Yangi',
  IN_PROGRESS: 'Jarayonda',
  WAITING_CLIENT: 'Mijoz kutilmoqda',
  CLOSED: 'Yopilgan',
};

function updateTicket(state: MockState, id: string, fn: (t: Ticket) => Ticket): MockState {
  return { ...state, tickets: state.tickets.map((t) => (t.id === id ? fn(t) : t)) };
}

export function setStatus(state: MockState, id: string, status: TicketStatus, who: string, now = Date.now()): MockState {
  return updateTicket(state, id, (t) => {
    if (t.status === status) return t;
    const history = [...t.history, { at: nowIso(now), who, type: 'status' as const, text: `${t.status} → ${status}` }];
    return { ...t, status, history, closedAt: status === 'CLOSED' ? nowIso(now) : null };
  });
}

/** "Men olaman": assign to me, move to IN_PROGRESS, stamp first response if missing. */
export function takeTicket(state: MockState, id: string, me: string, now = Date.now()): MockState {
  let s = assign(state, id, me, me, now);
  s = setStatus(s, id, 'IN_PROGRESS', me, now);
  return updateTicket(s, id, (t) =>
    t.firstResponseAt
      ? t
      : { ...t, firstResponseAt: nowIso(now), history: [...t.history, { at: nowIso(now), who: me, type: 'first_response', text: 'Birinchi javob' }] },
  );
}

export function assign(state: MockState, id: string, assigneeId: string, who: string, now = Date.now()): MockState {
  return updateTicket(state, id, (t) =>
    t.assigneeId === assigneeId
      ? t
      : { ...t, assigneeId, history: [...t.history, { at: nowIso(now), who, type: 'assign', text: `→ ${assigneeId}` }] },
  );
}

export function closeWithSolution(state: MockState, id: string, note: string, who: string, now = Date.now()): MockState {
  const s = setStatus(state, id, 'CLOSED', who, now);
  const n = note.trim();
  return updateTicket(s, id, (t) => ({
    ...t,
    solutionNote: n || null,
    history: n ? [...t.history, { at: nowIso(now), who, type: 'solution', text: n }] : t.history,
  }));
}

export function addTicketNote(state: MockState, id: string, note: string, who: string, now = Date.now()): MockState {
  return updateTicket(state, id, (t) => ({
    ...t,
    notes: [...t.notes, note],
    history: [...t.history, { at: nowIso(now), who, type: 'note', text: note.slice(0, 80) }],
  }));
}

export function createTicket(state: MockState, clientId: string, title: string, who: string, now = Date.now()): { state: MockState; ticket: Ticket } {
  const max = state.tickets.reduce((m, t) => Math.max(m, Number(t.id.replace(/\D/g, '')) || 0), 1000);
  const ticket: Ticket = {
    id: `T-${max + 1}`, clientId, title, status: 'NEW', assigneeId: null,
    createdAt: nowIso(now), firstResponseAt: null, slaDeadline: nowIso(now + 30 * 60_000),
    closedAt: null, solutionNote: null, notes: [],
    history: [{ at: nowIso(now), who, type: 'created', text: "Qo'lda ochildi" }],
  };
  return { state: { ...state, tickets: [...state.tickets, ticket] }, ticket };
}

/** Find the mock client for a real chat: exact id mapping first, then title hint. */
export function findClientForChat(clients: Client[], chat: Pick<ChatInfo, 'chatId' | 'title'>): { client: Client; by: 'id' | 'title' } | null {
  if (chat.chatId) {
    const id = chat.chatId.toLowerCase();
    const c = clients.find((c) => c.telegramChatId && c.telegramChatId.toLowerCase() === id);
    if (c) return { client: c, by: 'id' };
  }
  if (chat.title) {
    const title = chat.title.toLowerCase();
    const c = clients.find((c) => c.titleHint && title.includes(c.titleHint.toLowerCase()));
    if (c) return { client: c, by: 'title' };
  }
  return null;
}

/** Current ticket of a client: newest open one, else newest overall. */
export function currentTicket(tickets: Ticket[], clientId: string): Ticket | null {
  const own = tickets.filter((t) => t.clientId === clientId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return own.find((t) => t.status !== 'CLOSED') ?? own[0] ?? null;
}

/** Map a real chat id to a mock client (and un-map it from any other client). */
export function mapChatToClient(state: MockState, clientId: string, chatId: string): MockState {
  return {
    ...state,
    clients: state.clients.map((c) =>
      c.id === clientId ? { ...c, telegramChatId: chatId } : c.telegramChatId === chatId ? { ...c, telegramChatId: '' } : c,
    ),
  };
}
