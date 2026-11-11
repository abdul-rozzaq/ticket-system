// Realtime channel to the ticket server (Socket.IO namespace /events), held by the background worker so the access
// token never leaves it. Chrome keeps an MV3 service worker alive while a WebSocket exchanges messages (Socket.IO
// heartbeats count), so only the websocket transport is used. Events are forwarded to panels as TP_RT messages.
import { io, type Socket } from 'socket.io-client';
import type { ServerClient } from '../server/session';

export const RT_EVENTS = ['ticket.created', 'ticket.updated', 'reminder', 'sla.warning', 'draft.ready'] as const;
export type RtEvent = (typeof RT_EVENTS)[number];

export class Realtime {
  private socket: Socket | null = null;
  private url: string | null = null;

  constructor(
    private readonly server: ServerClient,
    private readonly onEvent: (ev: RtEvent, payload: unknown) => void,
  ) {}

  /** Connect when logged in (idempotent), disconnect when not. Call after login/logout and on worker start. */
  async sync(): Promise<void> {
    const st = await this.server.status();
    if (!st.connected || !st.baseUrl) return this.stop();
    if (this.socket && this.url === st.baseUrl) return;
    this.stop();
    this.url = st.baseUrl;
    const socket = io(`${st.baseUrl}/events`, {
      transports: ['websocket'],
      upgrade: false,
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 30_000,
      // evaluated on EVERY (re)connection attempt, so an expired token is refreshed first
      auth: (cb) => {
        void this.server.accessForRealtime().then((a) => cb({ token: a?.token ?? '' }));
      },
    });
    for (const ev of RT_EVENTS) socket.on(ev, (payload: unknown) => this.onEvent(ev, payload));
    // Socket.IO does not reconnect after a SERVER-initiated disconnect (what the server does for a rejected token):
    // retry slowly ourselves; the auth callback then re-reads / refreshes the token.
    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') {
        setTimeout(() => {
          if (this.socket === socket) socket.connect();
        }, 15_000);
      }
    });
    this.socket = socket;
  }

  stop(): void {
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.url = null;
  }

  get connected(): boolean {
    return !!this.socket?.connected;
  }
}
