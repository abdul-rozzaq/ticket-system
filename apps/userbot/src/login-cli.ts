// CLI fallback for logging the TP account in without the admin panel:
//   API_URL=... SERVICE_TOKEN=... TG_API_ID=... TG_API_HASH=... pnpm --filter @tp/userbot login
// Asks for phone, code and (if enabled) the 2FA password on the terminal, then hands the session to the API,
// which encrypts it. The session string is never printed or written to disk.
import { createInterface } from 'node:readline/promises';
import { ApiClient } from './api-client';
import { GramjsClient } from './gramjs-client';
import type { Logger } from './ports';

const silent: Logger = { info() {}, warn: (m) => console.warn(m), error: (m) => console.error(m) };

async function main() {
  const { API_URL = 'http://localhost:3000', SERVICE_TOKEN, TG_API_ID, TG_API_HASH } = process.env;

  if (!SERVICE_TOKEN || !TG_API_ID || !TG_API_HASH)
    throw new Error('Set SERVICE_TOKEN, TG_API_ID and TG_API_HASH');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const client = new GramjsClient({ apiId: Number(TG_API_ID), apiHash: TG_API_HASH, logger: silent });
  const api = new ApiClient({ baseUrl: API_URL, serviceToken: SERVICE_TOKEN, logger: silent });

  const phone = (await rl.question('Phone number (international format, e.g. +998901234567): ')).trim();

  await client.sendCode(phone);

  const code = (await rl.question('Code sent by Telegram: ')).trim();

  let r = await client.submitCode(code);

  if ('needPassword' in r) {
    const password = await rl.question('2FA password: ');
    r = await client.submitPassword(password);
  }

  await api.putSession(r.session, r.phone ?? phone);

  console.log('Logged in. The session was stored (encrypted) by the API. Start the userbot service now.');

  await client.stop();

  rl.close();
}

main().catch((e) => {
  console.error('Login failed:', (e as Error).message);
  process.exit(1);
});
