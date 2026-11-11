import { z } from 'zod';
import { ApiClient } from './api-client';
import { FakeTelegramClient } from './fake-client';
import { GramjsClient } from './gramjs-client';
import type { Logger } from './ports';
import { UserbotWorker } from './worker';

const env = z
  .object({
    API_URL: z.string().url().default('http://localhost:3000'),
    SERVICE_TOKEN: z.string().min(16),
    TG_API_ID: z.coerce.number().int().positive().optional(),
    TG_API_HASH: z.string().min(8).optional(),
    /** Run with an in-memory fake instead of MTProto (demo / smoke tests). */
    USERBOT_FAKE: z.enum(['true', 'false']).default('false'),
  })
  // docker compose passes unset optional variables as empty strings: treat them as not set
  .parse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== '')));

/** Structured one-line JSON logs. Callers must never pass message text, phone numbers, codes or sessions. */
const logger: Logger = {
  info: (msg, meta) => console.log(JSON.stringify({ level: 'info', msg, ...meta })),
  warn: (msg, meta) => console.warn(JSON.stringify({ level: 'warn', msg, ...meta })),
  error: (msg, meta) => console.error(JSON.stringify({ level: 'error', msg, ...meta })),
};

async function main() {
  const api = new ApiClient({ baseUrl: env.API_URL, serviceToken: env.SERVICE_TOKEN, logger });
  let client;
  if (env.USERBOT_FAKE === 'true') {
    client = new FakeTelegramClient();
    logger.warn('running with the FAKE Telegram client: nothing real is connected');
  } else {
    if (!env.TG_API_ID || !env.TG_API_HASH)
      throw new Error('TG_API_ID and TG_API_HASH are required (https://my.telegram.org)');
    client = new GramjsClient({ apiId: env.TG_API_ID, apiHash: env.TG_API_HASH, logger });
  }
  const worker = new UserbotWorker({ client, api, logger });
  const shutdown = async (sig: string) => {
    logger.info('shutting down', { sig });
    await worker.stop();
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  // Never crash the process on a stray rejection from the Telegram library.
  process.on('unhandledRejection', (e) => logger.error('unhandled rejection', { err: (e as Error)?.name }));
  logger.info('userbot starting');
  await worker.run();
}

main().catch((e) => {
  logger.error('fatal', { err: (e as Error).message });
  process.exit(1);
});
