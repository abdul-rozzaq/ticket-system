import { beforeEach, describe, expect, it } from 'vitest';
import { FakeTelegramClient } from '../src/fake-client';
import type { ApiCommand, ApiPort, FolderOp, FolderOpResult, FolderState, Logger } from '../src/ports';
import { UserbotWorker } from '../src/worker';

class FakeApi implements ApiPort {
  results: Array<{ id: string; ok: boolean; result?: Record<string, unknown>; error?: string }> = [];
  async getSession() {
    return 'FAKE-SESSION';
  }
  async putSession() {}
  async status() {}
  async message() {}
  async reaction() {}
  async dialogs() {}
  async commands(): Promise<ApiCommand[]> {
    return [];
  }
  async result(id: string, r: { ok: boolean; result?: Record<string, unknown>; error?: string }) {
    this.results.push({ id, ...r });
  }
}

const logger: Logger = { info() {}, warn() {}, error() {} };
const uid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

describe('folder commands', () => {
  let tg: FakeTelegramClient;
  let api: FakeApi;
  let sleeps: number[];
  let worker: UserbotWorker;

  const run = async (type: string, payload: Record<string, unknown> = {}) => {
    await worker.execute({ id: `cmd-${api.results.length}`, type, payload });
    return api.results.at(-1)!;
  };
  const apply = async (ops: FolderOp[]) =>
    ((await run('APPLY_FOLDERS', { ops })).result as { results: FolderOpResult[] }).results;

  beforeEach(async () => {
    tg = new FakeTelegramClient();
    tg.dialogs = [
      { chatId: 'c:1', title: 'Orient' },
      { chatId: 'c:2', title: 'Baraka' },
      { chatId: 'g:3', title: 'Old group' },
    ];
    api = new FakeApi();
    sleeps = [];
    worker = new UserbotWorker({
      client: tg,
      api,
      logger,
      sleep: async (ms) => void sleeps.push(ms),
      telegramGapMs: 0,
    });
    await worker.connect();
  });

  it('LIST_FOLDERS reports ALL folders (ours and foreign), visible chats, quota and premium', async () => {
    tg.addForeignFolder('Work', ['c:1']);
    const r = await run('LIST_FOLDERS');
    const state = (r.result as { state: FolderState }).state;
    expect(r.ok).toBe(true);
    expect(state.folders.map((f) => f.title)).toEqual(['Work']);
    expect(state.dialogKeys).toEqual(['c:1', 'c:2', 'g:3', 'self']);
    expect(state.limits).toEqual({ maxFolders: 10, maxChatsPerFolder: 100 });
    tg.premium = true;
    expect(((await run('LIST_FOLDERS')).result as { state: FolderState }).state.limits).toEqual({
      maxFolders: 20,
      maxChatsPerFolder: 200,
    });
  });

  it('creates, updates and deletes funnel folders and reports the Telegram folder id', async () => {
    const created = await apply([{ op: 'create', key: 'NEW', title: '🆕 Yangi', chatKeys: ['c:1', 'c:2'] }]);
    expect(created[0]).toMatchObject({ key: 'NEW', op: 'create', ok: true });
    const id = created[0].filterId!;
    expect(id).toBeGreaterThanOrEqual(2);
    expect(tg.folders).toEqual([{ id, title: '🆕 Yangi', chatKeys: ['c:1', 'c:2'] }]);

    const updated = await apply([
      { op: 'update', key: 'NEW', telegramFilterId: id, title: '🆕 Yangi', chatKeys: ['c:2'] },
    ]);
    expect(updated[0]).toMatchObject({ ok: true, filterId: id });
    expect(tg.folders[0].chatKeys).toEqual(['c:2']);

    expect((await apply([{ op: 'delete', key: 'NEW', telegramFilterId: id }]))[0]).toMatchObject({
      ok: true,
    });
    expect(tg.folders).toEqual([]);
  });

  it('NEVER touches foreign folders: unknown ids fail, foreign folders stay as they were', async () => {
    const foreign = tg.addForeignFolder('Work', ['c:1']);
    const mine = (
      await apply([{ op: 'create', key: 'WAITING', title: '⏳ Kutilmoqda', chatKeys: ['c:2'] }])
    )[0].filterId!;
    await apply([{ op: 'delete', key: 'WAITING', telegramFilterId: mine }]);
    expect(tg.folders).toEqual([foreign]);
  });

  it('refuses operations that are not funnel folders (second line of defence)', async () => {
    const r = await apply([
      { op: 'create', key: 'Work', title: 'Hacked', chatKeys: ['c:1'] },
      { op: 'delete', key: 'NEW', telegramFilterId: 1 }, // id 1 is not a valid folder id
      { op: 'delete', key: 'USER:not-a-uuid', telegramFilterId: 5 },
    ]);
    expect(r.every((x) => !x.ok)).toBe(true);
    expect(r[0].error).toContain('refused');
    expect(tg.called('applyFolderOp')).toHaveLength(0);
  });

  it('chats the account cannot see are skipped and reported, the rest still go into the folder', async () => {
    const r = await apply([{ op: 'create', key: 'NEW', title: '🆕 Yangi', chatKeys: ['c:1', 'c:999'] }]);
    expect(r[0]).toMatchObject({ ok: true, skipped: ['c:999'] });
    expect(tg.folders[0].chatKeys).toEqual(['c:1']);
  });

  it('Telegram refusing an empty folder (FILTER_INCLUDE_EMPTY) is an isolated failure; other operations still run', async () => {
    const r = await apply([
      { op: 'create', key: 'NEW', title: '🆕 Yangi', chatKeys: ['c:999'] }, // nothing resolvable
      { op: 'create', key: 'WAITING', title: '⏳ Kutilmoqda', chatKeys: ['c:1'] },
    ]);
    expect(r[0]).toMatchObject({ ok: false });
    expect(r[0].error).toContain('FILTER_INCLUDE_EMPTY');
    expect(r[1]).toMatchObject({ ok: true });
    expect(tg.folders).toHaveLength(1);
  });

  it('quota errors from Telegram are reported per operation', async () => {
    for (let i = 0; i < 10; i++) tg.addForeignFolder(`F${i}`);
    const r = await apply([{ op: 'create', key: 'NEW', title: '🆕 Yangi', chatKeys: ['c:1'] }]);
    expect(r[0]).toMatchObject({ ok: false });
    expect(r[0].error).toContain('DIALOG_FILTERS_TOO_MUCH');
  });

  it('FLOOD_WAIT during a folder operation: sleeps and retries, then succeeds', async () => {
    class FloodWaitError extends Error {
      seconds = 5;
      constructor() {
        super('A wait of 5 seconds is required');
      }
    }
    tg.failures.applyFolderOp = [new FloodWaitError()];
    const r = await apply([{ op: 'create', key: 'NEW', title: '🆕 Yangi', chatKeys: ['c:1'] }]);
    expect(r[0]).toMatchObject({ ok: true });
    expect(sleeps).toContain(6000);
    expect(worker.stats.floodWaits).toBe(1);
  });

  it('refuses absurd batch sizes and malformed payloads', async () => {
    const ops = Array.from({ length: 41 }, (_, i) => ({
      op: 'delete',
      key: `USER:${uid(i)}`,
      telegramFilterId: i + 2,
    }));
    const big = await run('APPLY_FOLDERS', { ops });
    expect(big.ok).toBe(false);
    expect(big.error).toContain('too many');
    expect((await run('APPLY_FOLDERS', { ops: 'nope' })).result).toEqual({ results: [] });
  });

  it('applies USER folders with uuid keys', async () => {
    const r = await apply([{ op: 'create', key: `USER:${uid(1)}`, title: '👤 Ali', chatKeys: ['g:3'] }]);
    expect(r[0]).toMatchObject({ ok: true });
  });
});
