import { Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { WS_EVENTS } from '@tp/shared';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEvents } from '../events/domain-events';

/**
 * Socket.IO namespace /events. Clients (extension, admin) connect with `auth: { token: <access JWT> }`.
 * Authenticated users join `user:<id>` and the shared `staff` room; payloads carry ids only (no message bodies),
 * clients fetch details through the REST API.
 */
@WebSocketGateway({ namespace: '/events', cors: { origin: true } })
export class RealtimeGateway implements OnGatewayConnection, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Realtime');
  private unsubscribe: Array<() => void> = [];
  @WebSocketServer() server!: Server;

  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly events: DomainEvents,
  ) {}

  async handleConnection(socket: Socket) {
    try {
      const token = (socket.handshake.auth?.token as string | undefined) ?? socket.handshake.headers.authorization?.replace('Bearer ', '');
      if (!token) throw new Error('no token');
      const payload = await this.auth.verifyAccess(token);
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user?.isActive) throw new Error('inactive');
      socket.data.userId = user.id;
      await socket.join(['staff', `user:${user.id}`]);
    } catch {
      socket.emit('error', { code: 'UNAUTHORIZED' });
      socket.disconnect(true);
    }
  }

  onModuleInit() {
    const to = (room: string, ev: string, payload: unknown) => this.server?.to(room).emit(ev, payload);
    this.unsubscribe = [
      this.events.on('ticket.created', (p) => to('staff', WS_EVENTS.ticketCreated, p)),
      this.events.on('ticket.updated', (p) => to('staff', WS_EVENTS.ticketUpdated, p)),
      this.events.on('ticket.closed', (p) => to('staff', WS_EVENTS.ticketUpdated, { ...p, change: 'closed' })),
      this.events.on('ticket.assigned', (p) => {
        to('staff', WS_EVENTS.ticketUpdated, { ...p, change: 'assigned' });
        if (p.assigneeId) to(`user:${p.assigneeId}`, WS_EVENTS.reminder, { kind: 'assigned', ticketId: p.ticketId, number: p.number, handoverNote: p.handoverNote ?? null });
      }),
    ];
    this.logger.log('realtime gateway ready');
  }

  onModuleDestroy() {
    this.unsubscribe.forEach((u) => u());
  }
}

@Module({ providers: [RealtimeGateway] })
export class RealtimeModule {}
