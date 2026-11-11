// End-to-end smoke test of the bot <-> API contract over REAL HTTP, with a fake Telegram.
//   API_URL=http://localhost:3100 SERVICE_TOKEN=... ADMIN_USER=admin ADMIN_PASSWORD=... pnpm --filter @tp/bot smoke
// The API must be running against a fresh database (it creates users, a group and a ticket).
import { config as loadDotenv } from 'dotenv';

// Local runs: read .env from the working directory (Docker passes real environment variables; no file there = no-op).
loadDotenv({ quiet: true });
import { ApiClient } from '../src/api-client';
import { FakeGateway } from '../src/fake-gateway';
import { BotWorker } from '../src/worker';

const API = process.env.API_URL ?? 'http://localhost:3100';
const SERVICE_TOKEN = process.env.SERVICE_TOKEN ?? '';
const ADMIN_USER = process.env.ADMIN_USER ?? 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';

const results: Array<[string, boolean, string?]> = [];
const check = (name: string, ok: boolean, detail?: string) => {
  results.push([name, ok, detail]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  -> ${detail}`}`);
};

async function http<T>(method: string, path: string, token?: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}/api/v1${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

async function main() {
  const logger = {
    info() {},
    warn: (m: string) => console.warn('warn:', m),
    error: (m: string) => console.error('error:', m),
  };
  // --- admin session
  const first = await http<{ accessToken: string }>('POST', '/auth/login', undefined, {
    username: ADMIN_USER,
    password: ADMIN_PASSWORD,
  });
  const admin = first.accessToken;
  const me = await http<{ id: string }>('GET', '/auth/me', admin);
  await http('PATCH', `/users/${me.id}`, admin, { available: false });

  // --- fake Telegram + real HTTP client + real worker
  const gw = new FakeGateway();
  const api = new ApiClient({ baseUrl: API, serviceToken: SERVICE_TOKEN, logger });
  const worker = new BotWorker({
    gateway: gw,
    api,
    logger,
    gaps: { global: 0, group: 0, private: 0 },
    tokenRetryMs: 50,
  });

  // --- no token configured yet: the worker must wait and report ERROR (we only check the API sees the bot later)
  await http('PUT', '/telegram/bot', admin, {
    token: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ',
    internalChatId: '-1009990001',
  });
  check(
    'worker starts with the token fetched over HTTP',
    (await worker.start()) && gw.startedWith[0]?.startsWith('123456789:'),
  );
  const st = await http<{ status: { alive: boolean; state: string } }>('GET', '/telegram/bot', admin);
  check('API sees the bot heartbeat', st.status.alive && st.status.state === 'CONNECTED');

  // --- staff linking through the real /start <code> flow
  const staff: Array<{ id: string; tg: string; name: string }> = [];
  for (const [i, name] of ['ali', 'vali'].entries()) {
    const u = await http<{ id: string }>('POST', '/users', admin, {
      username: name,
      displayName: name,
      password: 'Temp-password-1',
    });
    const { code } = await http<{ code: string }>('POST', `/users/${u.id}/telegram-code`, admin);
    const tg = String(2001 + i);
    await gw.typeCommand({ text: `/start ${code}`, fromId: tg, chatId: tg });
    const reply = gw.sent.at(-1);
    check(
      `/start <code> links ${name}`,
      !!reply && reply.chatId === tg && reply.text.includes("bog'landi"),
      reply?.text,
    );
    staff.push({ id: u.id, tg, name });
  }
  const before = gw.sent.length;
  await gw.typeCommand({ text: '/my', fromId: '999999', chatId: '999999' });
  check('strangers are ignored (no reply)', gw.sent.length === before);

  // --- ticket -> card in the internal group
  const group = await http<{ id: string }>('POST', '/client-groups', admin, {
    telegramChatId: '-1001234567890',
    title: 'Orient',
    companyName: 'Orient Motors',
    systemType: 'AMOCRM',
  });
  const created = await http<{ ticket: { id: string; number: number } }>('POST', '/tickets', admin, {
    clientGroupId: group.id,
    text: 'Webhook ulanmadi, parol: Hunter22secret',
  });
  const n = created.ticket.number;
  await worker.pollOnce(3);
  const card = gw.sent.find((m) => m.chatId === '-1009990001');
  check(
    'new-ticket card is posted to the internal group',
    !!card && card.text.includes(`#${n}`) && card.text.includes('Orient Motors'),
    card?.text,
  );
  check(
    'card has "Men olaman" + a button per staff member',
    !!card &&
      card.keyboard?.[0]?.[0]?.callback === `k:${n}` &&
      card.keyboard.flat().filter((b) => b.callback?.startsWith('a:')).length === 2,
  );
  check('secrets are masked in the card', !!card && !card.text.includes('Hunter22secret'));
  const detail = await http<{ cardMessageId: string | null }>('GET', `/tickets/${created.ticket.id}`, admin);
  check(
    'the posted card id was reported back to the API',
    detail.cardMessageId === card?.messageId,
    String(detail.cardMessageId),
  );

  // --- button race: two staff press "Men olaman" at the same moment
  await Promise.all([
    gw.pressButton({ id: 'q1', data: `k:${n}`, fromId: staff[0].tg, messageId: card!.messageId }),
    gw.pressButton({ id: 'q2', data: `k:${n}`, fromId: staff[1].tg, messageId: card!.messageId }),
  ]);
  const after = await http<{ assigneeId: string; status: string }>(
    'GET',
    `/tickets/${created.ticket.id}`,
    admin,
  );
  const winner = staff.find((s) => s.id === after.assigneeId);
  check('exactly one staff member got the ticket', !!winner && after.status === 'IN_PROGRESS');
  const alerts = gw.answers.filter((a) => a.alert);
  check(
    'the loser got an alert naming the winner',
    alerts.length === 1 && !!winner && (alerts[0].text ?? '').includes(winner.name),
    alerts[0]?.text,
  );
  check(
    'both presses got the up-to-date card',
    gw.edits.length >= 2 && gw.edits.every((e) => e.text.includes('tomonidan olindi')),
  );

  // --- the event-driven edit and the assignee DM arrive through the outbox
  await worker.pollOnce(2);
  check(
    'card edit from the ticket.assigned event was delivered',
    gw.edits.some((e) => e.messageId === card!.messageId),
  );

  // --- /my and a button from it
  await gw.typeCommand({ text: '/my', fromId: winner!.tg, chatId: winner!.tg });
  const my = gw.sent.at(-1);
  check(
    '/my lists the ticket with done/wait buttons',
    !!my && my.text.includes(`#${n}`) && my.keyboard?.[0]?.[0]?.callback === `d:${n}`,
  );
  await gw.pressButton({ id: 'q3', data: `d:${n}`, fromId: winner!.tg, messageId: card!.messageId });
  const closed = await http<{ status: string }>('GET', `/tickets/${created.ticket.id}`, admin);
  check('"Hal bo\'ldi" closes the ticket', closed.status === 'CLOSED');

  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  await worker.stop();
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('smoke crashed:', (e as Error).message);
  process.exit(2);
});
