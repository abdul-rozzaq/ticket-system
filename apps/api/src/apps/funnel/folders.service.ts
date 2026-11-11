import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Prisma } from '../../common/prisma-client';
import { folderTitle, staffFolderTitle } from '@tp/shared';
import { randomUUID } from 'node:crypto';
import { APP_ENV, Env } from '../../common/env';
import { PrismaService } from '../../common/prisma.service';
import { SettingsService } from '../../common/settings.service';
import { DomainEvents } from '../../common/domain-events';
import { OutboxService } from '../intake/outbox.service';
import {
  planFolderSync,
  type CurrentFolder,
  type DesiredFolder,
  type FolderOp,
  type FolderPlan,
} from '../../common/domain/folders';
import { FunnelService, stageKeyFor } from './funnel.service';

/** What the userbot reports about the TP account's Telegram folders. */
export interface TgFolderState {
  folders: Array<{ id: number; title: string; chatKeys: string[] }>;
  /** Canonical keys of every group chat the account can see (needed to resolve ids and skip unknown chats). */
  dialogKeys: string[];
  limits: { maxFolders: number; maxChatsPerFolder: number };
  premium: boolean;
}

export interface FolderOpResult {
  key: string;
  op: 'create' | 'update' | 'delete';
  ok: boolean;
  filterId?: number;
  /** Chats that could not be resolved to a Telegram peer and were left out of the folder. */
  skipped?: string[];
  error?: string;
}

export type SyncStatus = 'OK' | 'FAILED' | 'DISABLED' | 'BUSY' | 'USERBOT_OFFLINE';

export interface SyncReport {
  status: SyncStatus;
  runId: string;
  dryRun: boolean;
  plan?: FolderPlan;
  desired?: Array<{ key: string; title: string; chats: number }>;
  current?: Array<{ key: string; filterId: number; title: string; chats: number }>;
  limits?: TgFolderState['limits'] & { premium: boolean; foreignFolders: number };
  results?: FolderOpResult[];
  warnings: string[];
  error?: string;
  ms: number;
}

const LOCK_ID = 7305001;
const URGENCY_RANK = { HIGH: 0, NORMAL: 1, LOW: 2 } as Record<string, number>;

/**
 * Mirrors the funnel into Telegram chat folders of the TP account.
 *  - desired state = open tickets -> stage (exactly one folder per chat), computed from the database
 *  - current state = asked from the userbot (LIST_FOLDERS), diffed with the pure planner, applied with APPLY_FOLDERS
 *  - only folders recorded in TelegramFolderState are ever modified or deleted; foreign folders only count against the quota
 * Idempotent: running it twice in a row changes nothing the second time.
 */
@Injectable()
export class FoldersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Folders');
  private offs: Array<() => void> = [];
  private timer?: NodeJS.Timeout;
  private debounce?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly outbox: OutboxService,
    private readonly funnel: FunnelService,
    private readonly events: DomainEvents,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  onModuleInit() {
    if (this.env.FOLDERS_POLL_MS <= 0) return; // disabled (tests drive sync() explicitly)
    const trigger = () => this.requestReconcile('event');
    this.offs = (
      ['ticket.created', 'ticket.updated', 'ticket.assigned', 'ticket.closed', 'user.deactivated'] as const
    ).map((e) => this.events.on(e, trigger));
    this.timer = setInterval(
      () => void this.sync('periodic').catch((e) => this.logger.warn(`periodic sync failed: ${String(e)}`)),
      this.env.FOLDERS_POLL_MS,
    );
    this.timer.unref();
  }
  onModuleDestroy() {
    this.offs.forEach((o) => o());
    if (this.timer) clearInterval(this.timer);
    if (this.debounce) clearTimeout(this.debounce);
  }

  /** Many ticket events in a burst collapse into one sync, `funnel.reconcileDebounceSeconds` after the last one. */
  async requestReconcile(trigger: string): Promise<void> {
    const seconds = await this.settings.get('funnel.reconcileDebounceSeconds');
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = undefined;
      void this.sync(trigger).catch((e) => this.logger.warn(`sync failed: ${String(e)}`));
    }, seconds * 1000);
    this.debounce.unref();
  }

  // ------------------------------------------------------------------ desired state

  async buildDesired(state?: TgFolderState): Promise<{ desired: DesiredFolder[]; warnings: string[] }> {
    const warnings: string[] = [];
    const [stages, users, enabled, staffFolders] = await Promise.all([
      this.funnel.stages(),
      this.funnel.activeUsers(),
      this.funnel.enabled(),
      this.settings.get('funnel.staffFolders'),
    ]);
    const folders = new Map<string, DesiredFolder>();
    for (const kind of ['NEW', 'WAITING', 'OVERDUE'] as const) {
      const st = stages.find((s) => s.kind === kind);
      if (st?.isActive ?? true)
        folders.set(kind, { key: kind, title: folderTitle(st?.title ?? kind), chatKeys: [], kind: 'SYSTEM' });
    }
    if (staffFolders)
      for (const u of users)
        folders.set(`USER:${u.id}`, {
          key: `USER:${u.id}`,
          title: staffFolderTitle(u.displayName),
          chatKeys: [],
          kind: 'STAFF',
        });

    const open = await this.prisma.ticket.findMany({
      where: { status: { not: 'CLOSED' } },
      include: { clientGroup: true },
      orderBy: { openedAt: 'asc' },
    });
    open.sort((a, b) => (URGENCY_RANK[a.urgency] ?? 1) - (URGENCY_RANK[b.urgency] ?? 1)); // stable: urgent first, then oldest
    const dialogs = state ? new Set(state.dialogKeys) : null;
    for (const tk of open) {
      const key = stageKeyFor(tk, enabled);
      const folder = key ? folders.get(key) : undefined;
      if (!folder) continue; // closed, or the stage has no folder (disabled / staff folders off)
      const chat = this.resolveChat(tk.clientGroup.telegramChatId, dialogs);
      if (!chat) {
        warnings.push(
          `Chat topilmadi (${tk.clientGroup.companyName}): TP akkaunti bu guruhni ko'rmaydi, papkaga qo'shilmadi`,
        );
        continue;
      }
      if (!folder.chatKeys.includes(chat)) folder.chatKeys.push(chat);
    }
    // Telegram refuses an empty folder: keep it alive with a placeholder, or drop it until it has a chat.
    const mode = String(await this.settings.get('funnel.emptyFolders'));
    for (const [k, f] of [...folders]) {
      if (f.chatKeys.length) continue;
      if (mode === 'remove') folders.delete(k);
      else f.chatKeys.push('self');
    }
    return { desired: [...folders.values()], warnings };
  }

  /** WebK ids are ambiguous ("x:123"): resolve them to the channel or basic-group key the account actually has. */
  private resolveChat(key: string, dialogs: Set<string> | null): string | null {
    if (!dialogs) return key;
    if (dialogs.has(key)) return key;
    if (key.startsWith('x:')) {
      const id = key.slice(2);
      for (const k of [`c:${id}`, `g:${id}`]) if (dialogs.has(k)) return k;
    }
    return null;
  }

  // ------------------------------------------------------------------ talking to the userbot

  async userbotOnline(): Promise<boolean> {
    const row = await this.prisma.userbotSession.findFirst();
    return (
      !!row &&
      row.status === 'CONNECTED' &&
      !!row.lastActivityAt &&
      Date.now() - row.lastActivityAt.getTime() < 120_000
    );
  }

  private async listState(): Promise<TgFolderState> {
    const res = (await this.outbox.request('LIST_FOLDERS', {}, 30_000)) as { state?: TgFolderState };
    if (!res.state) throw new Error('userbot returned no folder state');
    return res.state;
  }

  // ------------------------------------------------------------------ sync

  /** Dry run: computes exactly what a sync would do, changes nothing (no Telegram writes, no DB writes). */
  preview(): Promise<SyncReport> {
    return this.run('preview', true);
  }

  async sync(trigger = 'manual'): Promise<SyncReport> {
    if (!(await this.settings.get('funnel.foldersEnabled')))
      return { status: 'DISABLED', runId: randomUUID(), dryRun: false, warnings: [], ms: 0 };
    // One sync at a time across all API instances (transaction-level advisory lock, released automatically).
    return this.prisma.$transaction(
      async (tx) => {
        const [{ ok }] = await tx.$queryRaw<
          Array<{ ok: boolean }>
        >`SELECT pg_try_advisory_xact_lock(${LOCK_ID}) AS ok`;
        if (!ok) return { status: 'BUSY' as const, runId: randomUUID(), dryRun: false, warnings: [], ms: 0 };
        return this.run(trigger, false);
      },
      { timeout: 240_000, maxWait: 5_000 },
    );
  }

  private async run(trigger: string, dryRun: boolean): Promise<SyncReport> {
    const t0 = Date.now();
    const runId = randomUUID();
    const base = { runId, dryRun, warnings: [] as string[] };
    const finish = async (r: Omit<SyncReport, 'ms' | 'runId' | 'dryRun'>): Promise<SyncReport> => {
      const report: SyncReport = { ...base, ...r, warnings: r.warnings ?? [], ms: Date.now() - t0 };
      if (!dryRun) await this.saveLastRun(trigger, report);
      return report;
    };

    if (!(await this.userbotOnline()))
      return finish({ status: 'USERBOT_OFFLINE', warnings: ['Userbot ulanmagan: papkalar sinxronlanmadi'] });

    let state: TgFolderState;
    try {
      state = await this.listState();
    } catch (e) {
      return finish({ status: 'FAILED', warnings: [], error: String((e as Error).message).slice(0, 300) });
    }

    const rows = await this.prisma.telegramFolderState.findMany();
    const byId = new Map(state.folders.map((f) => [f.id, f]));
    const currentOurs: CurrentFolder[] = [];
    const staleKeys: string[] = [];
    for (const r of rows) {
      const f = byId.get(r.telegramFilterId);
      if (f)
        currentOurs.push({
          key: r.key,
          telegramFilterId: r.telegramFilterId,
          title: f.title,
          chatKeys: f.chatKeys,
        });
      else staleKeys.push(r.key); // somebody deleted our folder by hand: it will be re-created if still wanted
    }
    const foreign = state.folders.length - currentOurs.length;

    const { desired, warnings } = await this.buildDesired(state);
    const plan = planFolderSync(desired, currentOurs, {
      maxFolders: state.limits.maxFolders,
      maxChatsPerFolder: state.limits.maxChatsPerFolder,
      foreignFolderCount: foreign,
    });
    const summary = {
      desired: desired.map((d) => ({ key: d.key, title: d.title, chats: d.chatKeys.length })),
      current: currentOurs.map((c) => ({
        key: c.key,
        filterId: c.telegramFilterId,
        title: c.title,
        chats: c.chatKeys.length,
      })),
      limits: { ...state.limits, premium: state.premium, foreignFolders: foreign },
      plan,
    };
    const allWarnings = [...warnings, ...plan.warnings];
    if (dryRun) return finish({ status: 'OK', warnings: allWarnings, ...summary });

    if (staleKeys.length)
      await this.prisma.telegramFolderState.deleteMany({ where: { key: { in: staleKeys } } });
    if (!plan.ops.length) return finish({ status: 'OK', warnings: allWarnings, results: [], ...summary });

    let results: FolderOpResult[];
    try {
      const res = (await this.outbox.request('APPLY_FOLDERS', { ops: plan.ops }, 180_000)) as {
        results?: FolderOpResult[];
      };
      results = res.results ?? [];
    } catch (e) {
      await this.logOps(runId, trigger, plan.ops, [], String((e as Error).message));
      return finish({
        status: 'FAILED',
        warnings: allWarnings,
        error: String((e as Error).message).slice(0, 300),
        ...summary,
      });
    }
    await this.persistResults(runId, trigger, plan.ops, results);
    const failed = results.filter((r) => !r.ok);
    return finish({
      status: failed.length ? 'FAILED' : 'OK',
      warnings: allWarnings,
      error: failed.length ? `${failed.length} amal bajarilmadi` : undefined,
      results,
      ...summary,
    });
  }

  // ------------------------------------------------------------------ persistence + log

  private async persistResults(runId: string, trigger: string, ops: FolderOp[], results: FolderOpResult[]) {
    const byKey = new Map(ops.map((o) => [`${o.op}:${o.key}`, o]));
    for (const r of results) {
      const op = byKey.get(`${r.op}:${r.key}`);
      if (r.ok && op) {
        if (r.op === 'delete') await this.prisma.telegramFolderState.deleteMany({ where: { key: r.key } });
        else if (op.op !== 'delete') {
          const chats = op.chatKeys.length - (r.skipped?.length ?? 0);
          const filterId = r.filterId ?? (op.op === 'update' ? op.telegramFilterId : undefined);
          if (filterId !== undefined) {
            await this.prisma.telegramFolderState.upsert({
              where: { key: r.key },
              create: { key: r.key, telegramFilterId: filterId, title: op.title, chatCount: chats },
              update: { telegramFilterId: filterId, title: op.title, chatCount: chats },
            });
          }
        }
      }
    }
    await this.logOps(runId, trigger, ops, results);
  }

  private async logOps(
    runId: string,
    trigger: string,
    ops: FolderOp[],
    results: FolderOpResult[],
    runError?: string,
  ) {
    const rows: Prisma.FolderOperationCreateManyInput[] = [];
    for (const op of ops) {
      const r = results.find((x) => x.key === op.key && x.op === op.op);
      rows.push({
        runId,
        trigger,
        op: op.op,
        key: op.key,
        ok: !!r?.ok,
        error: r ? r.error : (runError ?? 'no result'),
        detail: {
          title: op.op === 'delete' ? undefined : op.title,
          chats: op.op === 'delete' ? undefined : op.chatKeys.length,
          filterId: r?.filterId,
        } as Prisma.InputJsonValue,
      });
      for (const k of r?.skipped ?? [])
        rows.push({
          runId,
          trigger,
          op: 'skipped',
          key: op.key,
          ok: false,
          error: 'chat could not be resolved',
          detail: { chat: k },
        });
    }
    if (rows.length) await this.prisma.folderOperation.createMany({ data: rows });
    // keep the log bounded: 30 days
    await this.prisma.folderOperation.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - 30 * 86_400_000) } },
    });
  }

  private async saveLastRun(trigger: string, r: SyncReport) {
    const value = {
      at: new Date().toISOString(),
      trigger,
      status: r.status,
      ops: r.plan
        ? {
            create: r.plan.ops.filter((o) => o.op === 'create').length,
            update: r.plan.ops.filter((o) => o.op === 'update').length,
            delete: r.plan.ops.filter((o) => o.op === 'delete').length,
          }
        : null,
      degraded: r.plan?.degraded ?? false,
      warnings: r.warnings,
      error: r.error ?? null,
      ms: r.ms,
      limits: r.limits ?? null,
    };
    await this.settings.set('folders.lastRun', value);
  }

  // ------------------------------------------------------------------ admin views

  async status() {
    const [rows, lastRun, online, enabled] = await Promise.all([
      this.prisma.telegramFolderState.findMany({ orderBy: { key: 'asc' } }),
      this.prisma.setting.findUnique({ where: { key: 'folders.lastRun' } }),
      this.userbotOnline(),
      this.settings.get('funnel.foldersEnabled'),
    ]);
    return { enabled, userbotOnline: online, folders: rows, lastRun: lastRun?.value ?? null };
  }

  log(limit = 100, runId?: string) {
    return this.prisma.folderOperation.findMany({
      where: { runId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 500),
    });
  }
}
