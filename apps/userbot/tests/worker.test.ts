import { beforeEach, describe, expect, it } from 'vitest';
import { FakeTelegramClient } from '../src/fake-client';
import type { ApiCommand, ApiPort, Logger, TgDialog, TgMessage, TgReaction } from '../src/ports';
import { UserbotWorker } from '../src/worker';

class FakeApi implements ApiPort {
  session: string | null = 'FAKE-SESSION';
  messages: TgMessage[] = [];
  reactions: TgReaction[] = [];
  dialogCalls: TgDialog[][] = [];
  statuses: string[] = [];
  results: Array<{ id: string; ok: boolean; result?: Record<string, unknown>; error?: string }> = [];
  queue: ApiCommand[] = [];
  /** Make message()/reaction() fail this many times with the given status (undefined = network error). */
  failNext = 0;
  failStatus: number | undefined = undefined;

  async getSession() {
    return this.session;
  }
  async putSession() {}
  async status(state: string) {
    this.statuses.push(state);
  }
  private maybeFail() {
    if (this.failNext > 0) {
      this.failNext--;
      throw Object.assign(new Error('api down'), { status: this.failStatus });
    }
  }
  async message(m: TgMessage) {
    this.maybeFail();
    this.messages.push(m);
  }
  async reaction(r: TgReaction) {
    this.maybeFail();
    this.reactions.push(r);
  }
  async dialogs(items: TgDialog[]) {
    this.dialogCalls.push(items);
  }
  async commands() {
    const q = this.queue;
    this.queue = [];
    return q;
  }
  async result(id: string, r: { ok: boolean; result?: Record<string, unknown>; error?: string }) {
    this.results.push({ id, ...r });
  }
}

const logs: Array<{ level: string; msg: string; meta?: Record<string, unknown> }> = [];
const logger: Logger = {
  info: (msg, meta) => logs.push({ level: 'info', msg, meta }),
  warn: (msg, meta) => logs.push({ level: 'warn', msg, meta }),
  error: (msg, meta) => logs.push({ level: 'error', msg, meta }),
};

describe('UserbotWorker', () => {
  let tg: FakeTelegramClient;
  let api: FakeApi;
  let sleeps: number[];
  let worker: UserbotWorker;
  const flush = () => new Promise((r) => setImmediate(r));
  const cmd = (
    type: string,
    payload: Record<string, unknown> = {},
    id = Math.random().toString(36).slice(2),
  ): ApiCommand => ({ id, type, payload });

  beforeEach(() => {
    logs.length = 0;
    tg = new FakeTelegramClient();
    api = new FakeApi();
    sleeps = [];
    worker = new UserbotWorker({
      client: tg,
      api,
      logger,
      sleep: async (ms) => void sleeps.push(ms),
      telegramGapMs: 0,
    });
  });

  describe('startup', () => {
    it('connects with the stored session, reports CONNECTED and discovers group dialogs', async () => {
      tg.dialogs = [
        { chatId: 'c:1', title: 'Orient' },
        { chatId: 'g:2', title: 'Baraka' },
      ];
      await worker.connect();
      expect(tg.called('start')[0].args[0]).toBe('FAKE-SESSION');
      expect(api.statuses).toEqual(['CONNECTED']);
      expect(api.dialogCalls[0]).toEqual(tg.dialogs);
    });

    it('without a valid session it reports LOGGED_OUT and forwards nothing', async () => {
      api.session = null;
      await worker.connect();
      expect(api.statuses).toEqual(['LOGGED_OUT']);
      tg.emitMessage();
      await flush();
      expect(api.messages).toHaveLength(0);
      expect(tg.handlerCounts.message).toBe(0); // not even subscribed
    });

    it('a Telegram start failure is reported as ERROR and does not throw', async () => {
      tg.failures.start = [new Error('network unreachable')];
      await expect(worker.connect()).resolves.toBeUndefined();
      expect(api.statuses).toEqual(['ERROR']);
    });

    it('survives the API being down at startup', async () => {
      api.getSession = async () => {
        throw new Error('api down');
      };
      api.status = async () => {
        throw new Error('api down');
      };
      await expect(worker.connect()).resolves.toBeUndefined();
    });
  });

  describe('Telegram -> API', () => {
    beforeEach(async () => {
      await worker.connect();
    });

    it('forwards group messages (incoming and our own outgoing) and reactions', async () => {
      tg.emitMessage({ messageId: '10', text: 'Webhook ulanmadi' });
      tg.emitMessage({ messageId: '11', outgoing: true, text: "Ko'rib chiqamiz" });
      tg.emitReaction({ messageId: '10', emoji: '👀' });
      await flush();
      expect(api.messages.map((m) => [m.messageId, m.outgoing])).toEqual([
        ['10', false],
        ['11', true],
      ]);
      expect(api.reactions).toEqual([expect.objectContaining({ emoji: '👀', byMe: true })]);
      expect(worker.stats.forwarded).toBe(3);
    });

    it('subscribes only once even if connect() runs again (reconnect / login)', async () => {
      await worker.connect();
      await worker.connect();
      expect(tg.handlerCounts).toEqual({ message: 1, reaction: 1, disconnect: 1 });
      tg.emitMessage();
      await flush();
      expect(api.messages).toHaveLength(1); // not duplicated
    });

    it('keeps events in a backlog while the API is down and delivers them IN ORDER once it recovers', async () => {
      api.failNext = 2;
      api.failStatus = 503;
      tg.emitMessage({ messageId: '1' });
      await flush();
      tg.emitMessage({ messageId: '2' });
      await flush();
      expect(api.messages).toHaveLength(0);
      expect(worker.pending).toBe(2);
      // the API is back: a NEW event must not overtake the two older ones
      tg.emitMessage({ messageId: '3' });
      await flush();
      expect(api.messages.map((m) => m.messageId)).toEqual(['1', '2', '3']);
      expect(worker.pending).toBe(0);
    });

    it('retries the backlog on the next poll even if no new event arrives', async () => {
      api.failNext = 1;
      api.failStatus = undefined; // network error
      tg.emitMessage({ messageId: '1' });
      await flush();
      expect(worker.pending).toBe(1);
      await worker.pollOnce(0);
      await flush();
      expect(api.messages.map((m) => m.messageId)).toEqual(['1']);
    });

    it('concurrent bursts are delivered sequentially in arrival order', async () => {
      for (let i = 1; i <= 20; i++) tg.emitMessage({ messageId: String(i) });
      await flush();
      await flush();
      expect(api.messages.map((m) => Number(m.messageId))).toEqual(
        Array.from({ length: 20 }, (_, i) => i + 1),
      );
    });

    it('drops events the API rejects with a 4xx (they can never succeed) instead of retrying forever', async () => {
      api.failNext = 1;
      api.failStatus = 400;
      tg.emitMessage({ messageId: '1' });
      await flush();
      expect(worker.pending).toBe(0);
      expect(worker.stats.dropped).toBe(1);
    });

    it('bounds the backlog (oldest dropped first)', async () => {
      const w = new UserbotWorker({
        client: new FakeTelegramClient(),
        api,
        logger,
        sleep: async () => undefined,
        maxPending: 3,
      });
      const c = (w as unknown as { o: { client: FakeTelegramClient } }).o.client;
      await w.connect();
      api.failNext = 100;
      for (let i = 1; i <= 5; i++) c.emitMessage({ messageId: String(i) });
      await flush();
      expect(w.pending).toBe(3);
      expect(w.stats.dropped).toBe(2);
    });
  });

  describe('API commands -> Telegram', () => {
    beforeEach(async () => {
      await worker.connect();
    });

    it('login flow: send code -> submit code -> session returned in the result and worker goes CONNECTED', async () => {
      api.session = null;
      tg.validSession = null;
      const w = new UserbotWorker({
        client: tg,
        api,
        logger,
        sleep: async () => undefined,
        telegramGapMs: 0,
      });
      await w.connect();
      api.statuses.length = 0;
      api.queue = [
        cmd('LOGIN_SEND_CODE', { phone: '+998901234567' }, 'a'),
        cmd('LOGIN_SUBMIT_CODE', { code: '12345' }, 'b'),
      ];
      await w.pollOnce(0);
      expect(tg.called('sendCode')[0].args).toEqual(['+998901234567']);
      expect(api.results[0]).toMatchObject({ id: 'a', ok: true });
      expect(api.results[1]).toMatchObject({
        id: 'b',
        ok: true,
        result: { session: 'NEW-SESSION', phone: '+998901234567' },
      });
      expect(api.statuses).toContain('CONNECTED');
      tg.emitMessage({ messageId: '77' });
      await flush();
      expect(api.messages.at(-1)?.messageId).toBe('77'); // events flow after login
    });

    it('login flow with 2FA: needPassword, then password', async () => {
      tg.twoFactorPassword = 'secret-2fa';
      api.queue = [cmd('LOGIN_SUBMIT_CODE', { code: '12345' }, 'a')];
      await worker.pollOnce(0);
      expect(api.results[0]).toMatchObject({ ok: true, result: { needPassword: true } });
      api.queue = [cmd('LOGIN_SUBMIT_PASSWORD', { password: 'secret-2fa' }, 'b')];
      await worker.pollOnce(0);
      expect(api.results[1]).toMatchObject({ ok: true, result: { session: 'NEW-SESSION' } });
    });

    it('a wrong code is reported as a failed command and does not crash the worker', async () => {
      api.queue = [cmd('LOGIN_SUBMIT_CODE', { code: '00000' }, 'a'), cmd('DISCOVER_DIALOGS', {}, 'b')];
      await worker.pollOnce(0);
      expect(api.results[0]).toMatchObject({ id: 'a', ok: false, error: 'PHONE_CODE_INVALID' });
      expect(api.results[1]).toMatchObject({ id: 'b', ok: true }); // the next command still runs
    });

    it('DELETE_MESSAGES goes through deleteOwnMessages with the ids from the API', async () => {
      api.queue = [cmd('DELETE_MESSAGES', { chatId: 'c:1234567890', messageIds: ['5', 6] }, 'a')];
      await worker.pollOnce(0);
      expect(tg.called('deleteOwnMessages')[0].args).toEqual(['c:1234567890', ['5', '6']]);
      expect(api.results[0]).toMatchObject({ ok: true, result: { deleted: 2 } });
    });

    it('FLOOD_WAIT during a delete: sleeps the requested time and retries, then succeeds', async () => {
      class FloodWaitError extends Error {
        seconds = 7;
        constructor() {
          super('A wait of 7 seconds is required');
        }
      }
      tg.failures.deleteOwnMessages = [new FloodWaitError()];
      api.queue = [cmd('DELETE_MESSAGES', { chatId: 'c:1', messageIds: ['9'] }, 'a')];
      await worker.pollOnce(0);
      expect(sleeps).toContain(8000);
      expect(tg.called('deleteOwnMessages')).toHaveLength(2);
      expect(api.results[0]).toMatchObject({ ok: true });
      expect(worker.stats.floodWaits).toBe(1);
      expect(logs.some((l) => l.msg.includes('FLOOD_WAIT'))).toBe(true);
    });

    it('LOGOUT clears the session; unknown commands fail cleanly', async () => {
      api.queue = [cmd('LOGOUT', {}, 'a'), cmd('FLY_TO_MOON', {}, 'b')];
      await worker.pollOnce(0);
      expect(tg.called('logOut')).toHaveLength(1);
      expect(api.results[0]).toMatchObject({ ok: true });
      expect(api.results[1]).toMatchObject({ id: 'b', ok: false });
    });

    it('DISCOVER_DIALOGS posts the group list', async () => {
      tg.dialogs = [{ chatId: 'c:9', title: 'New group' }];
      api.dialogCalls.length = 0;
      api.queue = [cmd('DISCOVER_DIALOGS', {}, 'a')];
      await worker.pollOnce(0);
      expect(api.dialogCalls[0]).toEqual(tg.dialogs);
      expect(api.results[0]).toMatchObject({ ok: true, result: { groups: 1 } });
    });

    it('rate limits Telegram calls (minimum gap between them)', async () => {
      const w = new UserbotWorker({
        client: tg,
        api,
        logger,
        sleep: async (ms) => void sleeps.push(ms),
        telegramGapMs: 400,
      });
      await w.connect();
      sleeps.length = 0;
      api.queue = [
        cmd('DELETE_MESSAGES', { chatId: 'c:1', messageIds: ['1'] }),
        cmd('DELETE_MESSAGES', { chatId: 'c:1', messageIds: ['2'] }),
      ];
      await w.pollOnce(0);
      // real clock: the second call happens right after the first, so the limiter must have slept
      expect(sleeps.some((s) => s > 0 && s <= 400)).toBe(true);
    });
  });

  describe('resilience', () => {
    it('reconnects after a Telegram disconnect with backoff and reports DISCONNECTED then CONNECTED', async () => {
      await worker.connect();
      api.statuses.length = 0;
      tg.emitDisconnect();
      await new Promise((r) => setTimeout(r, 20));
      expect(api.statuses[0]).toBe('DISCONNECTED');
      expect(api.statuses).toContain('CONNECTED');
      expect(sleeps[0]).toBe(1000); // first backoff step
    });

    it('heartbeat reports the current state', async () => {
      await worker.connect();
      api.statuses.length = 0;
      await worker.heartbeatOnce();
      expect(api.statuses).toEqual(['CONNECTED']);
    });

    it('run() polls until stop() and a failing poll does not kill the loop', async () => {
      let polls = 0;
      api.commands = async () => {
        polls++;
        if (polls === 1) throw new Error('boom');
        if (polls === 3) await worker.stop();
        return [];
      };
      await worker.run();
      expect(polls).toBeGreaterThanOrEqual(3);
      expect(tg.called('stop').length).toBeGreaterThan(0);
    });
  });

  describe('privacy', () => {
    it('never logs message text, login codes, passwords or session strings', async () => {
      await worker.connect();
      tg.emitMessage({ text: 'PRIVATE-CUSTOMER-TEXT parol: hunter2' });
      api.failNext = 1;
      tg.emitMessage({ text: 'PRIVATE-CUSTOMER-TEXT-2' });
      api.queue = [
        cmd('LOGIN_SUBMIT_CODE', { code: '99999' }),
        cmd('LOGIN_SUBMIT_PASSWORD', { password: 'my-2fa-pass' }),
      ];
      await flush();
      await worker.pollOnce(0);
      const all = JSON.stringify(logs);
      for (const secret of [
        'PRIVATE-CUSTOMER-TEXT',
        'hunter2',
        '99999',
        'my-2fa-pass',
        'NEW-SESSION',
        'FAKE-SESSION',
      ]) {
        expect(all).not.toContain(secret);
      }
    });
  });
});
