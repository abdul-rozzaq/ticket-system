import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type UserbotCommand } from '../../common/prisma-client';
import { PrismaService } from '../../common/prisma.service';
import { CryptoService } from '../../common/crypto.service';

export type UserbotCommandType =
  | 'LOGIN_SEND_CODE'
  | 'LOGIN_SUBMIT_CODE'
  | 'LOGIN_SUBMIT_PASSWORD'
  | 'LOGOUT'
  | 'DELETE_MESSAGES'
  | 'DISCOVER_DIALOGS'
  | 'LIST_FOLDERS'
  | 'APPLY_FOLDERS';

const SECRET_TYPES = new Set<string>(['LOGIN_SUBMIT_CODE', 'LOGIN_SUBMIT_PASSWORD']);
/** Safe to run twice: deleting an already deleted message, re-listing dialogs, logging out twice. */
const RETRIABLE_TYPES = new Set<string>(['DELETE_MESSAGES', 'DISCOVER_DIALOGS', 'LOGOUT']);

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

  /**
   * Enqueues a command and waits for the userbot's answer (request/response over the outbox).
   * On timeout a command that was never picked up is cancelled so it cannot run later with stale data.
   */
  async request(
    type: UserbotCommandType,
    payload: Record<string, unknown>,
    timeoutMs = 30_000,
  ): Promise<Record<string, unknown>> {
    const cmd = await this.enqueue(type, payload);
    const end = Date.now() + timeoutMs;
    for (;;) {
      const row = await this.prisma.userbotCommand.findUniqueOrThrow({ where: { id: cmd.id } });
      if (row.status === 'DONE') return (row.result ?? {}) as Record<string, unknown>;
      if (row.status === 'FAILED')
        throw new Error(String((row.result as { error?: string } | null)?.error ?? 'userbot command failed'));
      if (Date.now() >= end) {
        await this.prisma.userbotCommand.updateMany({
          where: { id: cmd.id, status: 'PENDING' },
          data: { status: 'FAILED', result: { error: 'timeout' }, doneAt: new Date() },
        });
        throw new Error(`userbot did not answer ${type} within ${Math.round(timeoutMs / 1000)}s`);
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  private lastSweep = 0;

  /**
   * Commands a userbot claimed and then died on stay CLAIMED forever. After `staleMs`:
   * - login commands (their secrets are gone) and request/response commands (the requester gave up long ago) FAIL;
   * - idempotent ones (delete own command message, discovery, logout) go back to PENDING while they are < 1 h old.
   * Returns how many commands were touched. Runs at most once a minute (called from claim()).
   */
  async sweepStale(staleMs = 5 * 60_000, now = Date.now()): Promise<number> {
    const cutoff = new Date(now - staleMs);
    const stuck = await this.prisma.userbotCommand.findMany({
      where: { status: 'CLAIMED', claimedAt: { lt: cutoff } },
    });
    let n = 0;
    for (const c of stuck) {
      const retriable = RETRIABLE_TYPES.has(c.type) && now - c.createdAt.getTime() < 3_600_000;
      if (retriable) {
        const r = await this.prisma.userbotCommand.updateMany({
          where: { id: c.id, status: 'CLAIMED' },
          data: { status: 'PENDING', claimedAt: null },
        });
        n += r.count;
      } else {
        // goes through complete() so a failed login also resets the session status
        await this.complete(c.id, false, {}, 'userbot did not finish the command (restarted?)');
        n++;
      }
    }
    if (n) this.logger.warn(`swept ${n} stale userbot command(s)`);
    return n;
  }

  /** Atomically hands out pending commands (SKIP LOCKED: two pollers never get the same command). */
  async claim(waitSeconds: number, limit = 10): Promise<UserbotCommand[]> {
    if (Date.now() - this.lastSweep > 60_000) {
      this.lastSweep = Date.now();
      await this.sweepStale().catch((e) => this.logger.warn(`sweep failed: ${String(e).slice(0, 200)}`));
    }
    const deadline = Date.now() + Math.min(Math.max(waitSeconds, 0), 25) * 1000;
    for (;;) {
      const rows = await this.prisma.$queryRaw<UserbotCommand[]>`
        UPDATE "UserbotCommand" SET "status" = 'CLAIMED', "claimedAt" = now()
        WHERE "id" IN (
          SELECT "id" FROM "UserbotCommand" WHERE "status" = 'PENDING' ORDER BY "createdAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED
        ) RETURNING *`;
      if (rows.length || Date.now() >= deadline) {
        const secretIds = rows.filter((r) => SECRET_TYPES.has(r.type)).map((r) => r.id);
        if (secretIds.length)
          await this.prisma.userbotCommand.updateMany({
            where: { id: { in: secretIds } },
            data: { payload: { redacted: true } },
          });
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
      data: {
        status: ok ? 'DONE' : 'FAILED',
        result: { ...safeResult, ...(error ? { error: error.slice(0, 300) } : {}) } as Prisma.InputJsonValue,
        doneAt: new Date(),
      },
    });

    const row = await this.sessionRow();
    if (ok) {
      switch (cmd.type) {
        case 'LOGIN_SEND_CODE':
          await this.setSession(row.id, { status: 'CODE_SENT' });
          break;
        case 'LOGIN_SUBMIT_CODE':
        case 'LOGIN_SUBMIT_PASSWORD':
          if (session)
            await this.setSession(row.id, {
              status: 'CONNECTED',
              sessionEnc: this.crypto.encrypt(session),
              info: { phone: safeResult.phone ?? null },
            });
          else if (safeResult.needPassword) await this.setSession(row.id, { status: 'NEED_PASSWORD' });
          break;
        case 'LOGOUT':
          await this.setSession(row.id, { status: 'LOGGED_OUT', sessionEnc: null });
          break;
      }
    } else if (cmd.type.startsWith('LOGIN_')) {
      await this.setSession(row.id, {
        status: 'LOGIN_FAILED',
        info: { error: (error ?? 'failed').slice(0, 200) },
      });
    }
    return cmd.type;
  }

  async sessionRow() {
    return (
      (await this.prisma.userbotSession.findFirst()) ??
      (await this.prisma.userbotSession.create({ data: {} }))
    );
  }

  private setSession(
    id: string,
    data: { status: string; sessionEnc?: string | null; info?: Record<string, unknown> },
  ) {
    const { info, ...rest } = data;

    return this.prisma.userbotSession.update({
      where: { id },
      data: { ...rest, ...(info ? { info: info as Prisma.InputJsonValue } : {}) },
    });
  }

  async storeSession(session: string, phone?: string) {
    const row = await this.sessionRow();
    await this.setSession(row.id, {
      status: 'CONNECTED',
      sessionEnc: this.crypto.encrypt(session),
      info: { phone: phone ?? null },
    });
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
      data: {
        lastActivityAt: new Date(),
        ...(state === 'CONNECTED' || state === 'DISCONNECTED' || state === 'ERROR' ? { status: state } : {}),
        info: { ...((row.info ?? {}) as object), ...info } as Prisma.InputJsonValue,
      },
    });
  }
}
