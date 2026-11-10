import { beforeEach, describe, expect, it } from 'vitest';
import { FakeGateway } from '../src/fake-gateway';
import {
  TgError,
  type BotApiPort,
  type CallbackResult,
  type IncomingCommand,
  type Keyboard,
  type Logger,
  type OutboxItem,
} from '../src/ports';
import { BotWorker } from '../src/worker';

class FakeApi implements BotApiPort {
  token: string | null = 'TOKEN-1';
  queue: OutboxItem[] = [];
  results: Array<{ id: string; ok: boolean; result?: Record<string, unknown>; error?: string }> = [];
  statuses: Array<{ state: string; detail?: string }> = [];
  callbackResult: CallbackResult = { answer: 'ok', alert: false, edit: null };
  commandReplies: Array<{ text: string; keyboard?: Keyboard }> | null = null;
  callbacks: Array<{ fromId: string; data: string }> = [];
  commands: IncomingCommand[] = [];
  failResult = 0;
  failCallback = false;

  async config(): Promise<{ token: string | null; internalChatId: string | null }> {
    return { token: this.token, internalChatId: '-100999' };
  }
  async outbox() {
    const q = this.queue;
    this.queue = [];
    return q;
  }
  async outboxResult(id: string, r: { ok: boolean; result?: Record<string, unknown>; error?: string }) {
    if (this.failResult > 0) {
      this.failResult--;
      throw new Error('api down');
    }
    this.results.push({ id, ...r });
  }
  async callback(fromId: string, data: string) {
    if (this.failCallback) throw new Error('api down');
    this.callbacks.push({ fromId, data });
    return this.callbackResult;
  }
  async command(c: IncomingCommand) {
    this.commands.push(c);
    return { replies: this.commandReplies };
  }
  async status(state: 'CONNECTED' | 'DISCONNECTED' | 'ERROR', detail?: string) {
    this.statuses.push({ state, detail });
  }
}

const logs: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
const logger: Logger = {
  info: (msg, meta) => logs.push({ msg, meta }),
  warn: (msg, meta) => logs.push({ msg, meta }),
  error: (msg, meta) => logs.push({ msg, meta }),
};

describe('BotWorker', () => {
  let gw: FakeGateway;
  let api: FakeApi;
  let sleeps: number[];
  let worker: BotWorker;
  const item = (
    kind: string,
    payload: Record<string, unknown>,
    id = Math.random().toString(36).slice(2),
  ): OutboxItem => ({ id, kind, payload });
  const kb: Keyboard = [
    [{ text: '🙋 Men olaman', callback: 'k:1' }],
    [{ text: '🔗', url: 'https://t.me/c/1/1' }],
  ];

  beforeEach(() => {
    logs.length = 0;
    gw = new FakeGateway();
    api = new FakeApi();
    sleeps = [];
    worker = new BotWorker({
      gateway: gw,
      api,
      logger,
      sleep: async (ms) => void sleeps.push(ms),
      gaps: { global: 0, group: 0, private: 0 },
      tokenRetryMs: 5,
    });
  });

  describe('startup', () => {
    it('registers its handlers before the gateway starts and starts with the token from the API', async () => {
      expect(gw.hasHandlers).toBe(true);
      expect(await worker.start()).toBe(true);
      expect(gw.startedWith).toEqual(['TOKEN-1']);
      expect(api.statuses.at(-1)).toEqual({ state: 'CONNECTED', detail: undefined });
    });

    it('waits (reporting ERROR) until an admin configures the token', async () => {
      api.token = null;
      let calls = 0;
      const orig = api.config.bind(api);
      api.config = async () => {
        if (++calls === 3) api.token = 'LATE-TOKEN';
        return orig();
      };
      expect(await worker.start()).toBe(true);
      expect(gw.startedWith).toEqual(['LATE-TOKEN']);
      expect(api.statuses.filter((s) => s.state === 'ERROR')).toHaveLength(2);
      expect(sleeps.length).toBe(2);
    });

    it('an invalid token (Telegram 401) is reported and retried, not fatal', async () => {
      gw.failures.start = [new TgError('Unauthorized', 401)];
      expect(await worker.start()).toBe(true);
      expect(gw.startedWith).toHaveLength(1);
      expect(api.statuses.some((s) => s.state === 'ERROR' && s.detail?.includes('token'))).toBe(true);
    });

    it('survives the API being down at startup', async () => {
      let n = 0;
      api.config = async () => {
        if (++n === 1) throw new Error('api down');
        return { token: 'T', internalChatId: null };
      };
      expect(await worker.start()).toBe(true);
    });

    it('restarts the gateway when the admin rotates the token', async () => {
      await worker.start();
      api.token = 'TOKEN-2';
      await worker.heartbeatOnce();
      expect(gw.startedWith).toEqual(['TOKEN-1', 'TOKEN-2']);
    });
  });

  describe('button presses', () => {
    beforeEach(async () => {
      await worker.start();
    });

    it('forwards to the API, answers the callback FIRST, then edits the card', async () => {
      api.callbackResult = {
        answer: '✅ Ali tomonidan olindi',
        alert: false,
        edit: { text: 'NEW CARD', keyboard: kb },
      };
      const order: string[] = [];
      const a = gw.answerCallback.bind(gw);
      const e = gw.editMessage.bind(gw);
      gw.answerCallback = async (...x) => (order.push('answer'), a(...x));
      gw.editMessage = async (...x) => (order.push('edit'), e(...x));
      await gw.pressButton({ data: 'k:5', fromId: '1002', chatId: '-100999', messageId: '500' });
      expect(api.callbacks).toEqual([{ fromId: '1002', data: 'k:5' }]);
      expect(order).toEqual(['answer', 'edit']);
      expect(gw.answers[0]).toMatchObject({ id: 'cbq1', text: '✅ Ali tomonidan olindi', alert: false });
      expect(gw.edits[0]).toMatchObject({
        chatId: '-100999',
        messageId: '500',
        text: 'NEW CARD',
        keyboard: kb,
      });
    });

    it('shows alerts (e.g. "already taken") and still refreshes the card', async () => {
      api.callbackResult = {
        answer: 'Bu tiketni allaqachon Ali olgan',
        alert: true,
        edit: { text: 'CARD', keyboard: [] },
      };
      await gw.pressButton({ data: 'k:5' });
      expect(gw.answers[0].alert).toBe(true);
      expect(gw.edits).toHaveLength(1);
    });

    it('snooze/ignored presses: answer without editing', async () => {
      api.callbackResult = { answer: '', alert: false, edit: null };
      await gw.pressButton({ data: 's:5' });
      expect(gw.answers[0].text).toBeUndefined();
      expect(gw.edits).toHaveLength(0);
    });

    it('an API failure still answers the callback (no endless spinner) with a friendly error', async () => {
      api.failCallback = true;
      await gw.pressButton({ data: 'k:5' });
      expect(gw.answers[0]).toMatchObject({ alert: true });
      expect(gw.answers[0].text).toContain('Xatolik');
      expect(gw.edits).toHaveLength(0);
    });

    it('"message is not modified" is not an error', async () => {
      api.callbackResult = { answer: '', alert: false, edit: { text: 'same', keyboard: [] } };
      gw.failures.editMessage = [new TgError('Bad Request: message is not modified', 400)];
      await gw.pressButton({ data: 'b:5' });
      expect(logs.some((l) => l.msg.includes('failed'))).toBe(false);
    });
  });

  describe('commands', () => {
    beforeEach(async () => {
      await worker.start();
    });

    it('sends the API’s replies (with keyboards) into the same chat', async () => {
      api.commandReplies = [
        { text: 'Sizning tiketlaringiz', keyboard: [[{ text: '✅ #5', callback: 'd:5' }]] },
      ];
      await gw.typeCommand({ text: '/my', chatId: '1001', fromId: '1001' });
      expect(api.commands[0]).toMatchObject({ text: '/my', chatType: 'private' });
      expect(gw.sent).toHaveLength(1);
      expect(gw.sent[0]).toMatchObject({ chatId: '1001', text: 'Sizning tiketlaringiz' });
      expect(gw.sent[0].keyboard).toEqual([[{ text: '✅ #5', callback: 'd:5' }]]);
    });

    it('stays silent when the API says to ignore the sender', async () => {
      api.commandReplies = null;
      await gw.typeCommand({ text: '/my', fromId: '424242' });
      expect(gw.sent).toHaveLength(0);
    });
  });

  describe('outbox', () => {
    beforeEach(async () => {
      await worker.start();
    });

    it('SEND_CARD posts with the keyboard and reports the message id; SEND_TEXT can reply to the card', async () => {
      api.queue = [
        item('SEND_CARD', { ticketId: 't', chatId: '-100999', text: 'CARD', keyboard: kb }, 'a'),
        item('SEND_TEXT', { chatId: '-100999', text: 'reminder', replyToMessageId: '100' }, 'b'),
      ];
      expect(await worker.pollOnce(0)).toBe(2);
      expect(gw.sent[0]).toMatchObject({ chatId: '-100999', text: 'CARD', keyboard: kb });
      expect(api.results[0]).toEqual({ id: 'a', ok: true, result: { messageId: gw.sent[0].messageId } });
      expect(gw.sent[1].replyToMessageId).toBe('100');
    });

    it('EDIT_CARD edits the given message', async () => {
      api.queue = [
        item('EDIT_CARD', { chatId: '-100999', messageId: '777', text: 'UPDATED', keyboard: [] }, 'a'),
      ];
      await worker.pollOnce(0);
      expect(gw.edits[0]).toMatchObject({ chatId: '-100999', messageId: '777', text: 'UPDATED' });
      expect(api.results[0]).toMatchObject({ id: 'a', ok: true });
    });

    it('Telegram failures are reported (the API retries) without crashing the loop', async () => {
      gw.failures.sendMessage = [new TgError('Forbidden: bot was blocked by the user', 403)];
      api.queue = [
        item('SEND_TEXT', { chatId: '1002', text: 'DM' }, 'a'),
        item('SEND_TEXT', { chatId: '1001', text: 'DM2' }, 'b'),
      ];
      await worker.pollOnce(0);
      expect(api.results[0]).toMatchObject({ id: 'a', ok: false });
      expect(api.results[0].error).toContain('403');
      expect(api.results[1]).toMatchObject({ id: 'b', ok: true });
    });

    it('HTTP 429: sleeps retry_after+1 seconds and retries the same call', async () => {
      gw.failures.sendMessage = [new TgError('Too Many Requests: retry after 7', 429, 7)];
      api.queue = [item('SEND_TEXT', { chatId: '-100999', text: 'x' }, 'a')];
      await worker.pollOnce(0);
      expect(sleeps).toContain(8000);
      expect(gw.sent).toHaveLength(1);
      expect(api.results[0]).toMatchObject({ ok: true });
      expect(worker.stats.rateLimited).toBe(1);
    });

    it('does not sleep through absurd 429 waits', async () => {
      gw.failures.sendMessage = [new TgError('Too Many Requests', 429, 3600)];
      api.queue = [item('SEND_TEXT', { chatId: '-100999', text: 'x' }, 'a')];
      await worker.pollOnce(0);
      expect(sleeps).toEqual([]);
      expect(api.results[0]).toMatchObject({ ok: false });
    });

    it('malformed or unknown items fail cleanly', async () => {
      api.queue = [
        item('SEND_TEXT', { text: 'no chat' }, 'a'),
        item('LAUNCH_ROCKET', { chatId: '1', text: 'x' }, 'b'),
      ];
      await worker.pollOnce(0);
      expect(api.results.map((r) => r.ok)).toEqual([false, false]);
      expect(gw.sent).toHaveLength(0);
    });

    it('NEVER sends twice: if the API is down when reporting, the result is kept and reported later instead of re-sending', async () => {
      api.failResult = 1;
      api.queue = [item('SEND_CARD', { chatId: '-100999', text: 'CARD' }, 'a')];
      await worker.pollOnce(0);
      expect(gw.sent).toHaveLength(1);
      expect(api.results).toHaveLength(0);
      expect(worker.pendingReports).toBe(1);
      await worker.pollOnce(0); // next poll flushes the report first
      expect(api.results).toEqual([{ id: 'a', ok: true, result: { messageId: gw.sent[0].messageId } }]);
      expect(worker.pendingReports).toBe(0);
      expect(gw.sent).toHaveLength(1);
    });

    it('rate limits per chat: a burst into one group is spaced out', async () => {
      const w = new BotWorker({
        gateway: gw,
        api,
        logger,
        sleep: async (ms) => void sleeps.push(ms),
        gaps: { global: 0, group: 3000, private: 1000 },
      });
      await w.start();
      sleeps.length = 0;
      api.queue = [1, 2, 3].map((i) => item('SEND_TEXT', { chatId: '-100999', text: String(i) }));
      await w.pollOnce(0);
      expect(gw.sent).toHaveLength(3);
      expect(sleeps.filter((s) => s > 0 && s <= 3000).length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('resilience and privacy', () => {
    it('run() polls until stop() and a failing poll does not kill the loop', async () => {
      let polls = 0;
      api.outbox = async () => {
        polls++;
        if (polls === 1) throw new Error('boom');
        if (polls === 3) await worker.stop();
        return [];
      };
      await worker.run();
      expect(polls).toBeGreaterThanOrEqual(3);
      expect(gw.started).toBe(false);
    });

    it('never logs message bodies, tokens or user names', async () => {
      await worker.start();
      gw.failures.sendMessage = [new TgError('Forbidden', 403)];
      api.failCallback = true;
      api.queue = [item('SEND_TEXT', { chatId: '1', text: 'SECRET-CUSTOMER-TEXT parol: hunter2' }, 'a')];
      await worker.pollOnce(0);
      await gw.pressButton({ data: 'k:5' });
      api.commandReplies = [{ text: 'PRIVATE-REPLY' }];
      api.failCallback = false;
      await gw.typeCommand({ text: '/my' });
      const all = JSON.stringify(logs);
      for (const s of ['SECRET-CUSTOMER-TEXT', 'hunter2', 'TOKEN-1', 'PRIVATE-REPLY'])
        expect(all).not.toContain(s);
    });
  });
});
