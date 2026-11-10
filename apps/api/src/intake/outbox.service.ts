import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type UserbotCommand } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto.service';

export type UserbotCommandType =
  | 'LOGIN_SEND_CODE'
  | 'LOGIN_SUBMIT_CODE'
  | 'LOGIN_SUBMIT_PASSWORD'
  | 'LOGOUT'
  | 'DELETE_MESSAGES'
  | 'DISCOVER_DIALOGS';

const SECRET_TYPES = new Set<string>(['LOGIN_SUBMIT_CODE', 'LOGIN_SUBMIT_PASSWORD']);

/**
 * Commands for the userbot process. The userbot long-polls `claim()` through the API (it has no DB access).
 * Login codes/passwords travel in `payload`; the payload is wiped as soon as the command is claimed so secrets do
 * not rest in the database, and the session string the userbot returns is encrypted before it is stored.
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger('Outbox');
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  enqueue(type: UserbotCommandType, payload: Record<string, unknown> = {}) {
    return this.prisma.userbotCommand.create({ data: { type, payload: payload as Prisma.InputJsonValue } });
  }

  /** Atomically hands out pending commands (SKIP LOCKED: two pollers never get the same command). */
  async claim(waitSeconds: number, limit = 10): Promise<UserbotCommand[]> {
    const deadline = Date.now() + Math.min(Math.max(waitSeconds, 0), 25) * 1000;
    for (;;) {
      const rows = await this.prisma.$queryRaw<UserbotCommand[]>`
        UPDATE "UserbotCommand" SET "status" = 'CLAIMED', "claimedAt" = now()
        WHERE "id" IN (
          SELECT "id" FROM "UserbotCommand" WHERE "status" = 'PENDING' ORDER BY "createdAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED
        ) RETURNING *`;
      if (rows.length || Date.now() >= deadline) {
        const secretIds = rows.filter((r) => SECRET_TYPES.has(r.type)).map((r) => r.id);
        if (secretIds.length) await this.prisma.userbotCommand.updateMany({ where: { id: { in: secretIds } }, data: { payload: { redacted: true } } });
        return rows;
      }
      await new Promise((r) => setTimeout(r, 700));
    }
  }

  /** Records the outcome; applies login side effects (session storage, status). Secrets are stripped from `result`. */
  async complete(id: string, ok: boolean, result: Record<string, unknown> = {}, error?: string) {
    const cmd = await this.prisma.userbotCommand.findUnique({ where: { id } });
    if (!cmd) return null;
    const { session, ...safeResult } = result as { session?: string } & Record<string, unknown>;
    await this.prisma.userbotCommand.update({
      where: { id },
      data: { status: ok ? 'DONE' : 'FAILED', result: { ...safeResult, ...(error ? { error: error.slice(0, 300) } : {}) } as Prisma.InputJsonValue, doneAt: new Date() },
    });

    const row = await this.sessionRow();
    if (ok) {
      switch (cmd.type) {
        case 'LOGIN_SEND_CODE':
          await this.setSession(row.id, { status: 'CODE_SENT' });
          break;
        case 'LOGIN_SUBMIT_CODE':
        case 'LOGIN_SUBMIT_PASSWORD':
          if (session) await this.setSession(row.id, { status: 'CONNECTED', sessionEnc: this.crypto.encrypt(session), info: { phone: safeResult.phone ?? null } });
          else if (safeResult.needPassword) await this.setSession(row.id, { status: 'NEED_PASSWORD' });
          break;
        case 'LOGOUT':
          await this.setSession(row.id, { status: 'LOGGED_OUT', sessionEnc: null });
          break;
      }
    } else if (cmd.type.startsWith('LOGIN_')) {
      await this.setSession(row.id, { status: 'LOGIN_FAILED', info: { error: (error ?? 'failed').slice(0, 200) } });
    }
    return cmd.type;
  }

  async sessionRow() {
    return (await this.prisma.userbotSession.findFirst()) ?? (await this.prisma.userbotSession.create({ data: {} }));
  }

  private setSession(id: string, data: { status: string; sessionEnc?: string | null; info?: Record<string, unknown> }) {
    const { info, ...rest } = data;
    return this.prisma.userbotSession.update({ where: { id }, data: { ...rest, ...(info ? { info: info as Prisma.InputJsonValue } : {}) } });
  }

  async getSessionString(): Promise<string | null> {
    const row = await this.sessionRow();
    if (!row.sessionEnc) return null;
    try {
      return this.crypto.decrypt(row.sessionEnc);
    } catch {
      this.logger.error('stored userbot session could not be decrypted (wrong ENCRYPTION_KEY?)');
      return null;
    }
  }

  async heartbeat(state: string, info: Record<string, unknown>) {
    const row = await this.sessionRow();
    await this.prisma.userbotSession.update({
      where: { id: row.id },
      data: { lastActivityAt: new Date(), ...(state === 'CONNECTED' || state === 'DISCONNECTED' || state === 'ERROR' ? { status: state } : {}), info: { ...((row.info ?? {}) as object), ...info } as Prisma.InputJsonValue },
    });
  }
}
