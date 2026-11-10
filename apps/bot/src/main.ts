import { z } from 'zod';
import { ApiClient } from './api-client';
import { FakeGateway } from './fake-gateway';
import { GrammyGateway } from './grammy-gateway';
import type { BotGateway, Logger } from './ports';
import { BotWorker } from './worker';

const env = z
  .object({
    API_URL: z.string().url().default('http://localhost:3000'),
    SERVICE_TOKEN: z.string().min(16),
    /** polling (default, no public URL needed) or webhook (needs BOT_WEBHOOK_URL + BOT_WEBHOOK_SECRET). */
    BOT_MODE: z.enum(['polling', 'webhook']).default('polling'),
    BOT_WEBHOOK_URL: z.string().url().optional(),
    BOT_WEBHOOK_SECRET: z.string().min(16).optional(),
    BOT_WEBHOOK_PORT: z.coerce.number().int().default(8443),
    /** In-memory fake instead of Telegram (smoke tests). */
    BOT_FAKE: z.enum(['true', 'false']).default('false'),
  })
  .parse(process.env);

const logger: Logger = {
  info: (msg, meta) => console.log(JSON.stringify({ level: 'info', msg, ...meta })),
  warn: (msg, meta) => console.warn(JSON.stringify({ level: 'warn', msg, ...meta })),
  error: (msg, meta) => console.error(JSON.stringify({ level: 'error', msg, ...meta })),
};

async function main() {
  const api = new ApiClient({ baseUrl: env.API_URL, serviceToken: env.SERVICE_TOKEN, logger });
  let gateway: BotGateway;
  if (env.BOT_FAKE === 'true') {
    gateway = new FakeGateway();
    logger.warn('running with the FAKE Telegram gateway: nothing real is connected');
  } else if (env.BOT_MODE === 'webhook') {
    if (!env.BOT_WEBHOOK_URL || !env.BOT_WEBHOOK_SECRET)
      throw new Error('webhook mode needs BOT_WEBHOOK_URL and BOT_WEBHOOK_SECRET');
    gateway = new GrammyGateway({
      logger,
      mode: 'webhook',
      webhook: { publicUrl: env.BOT_WEBHOOK_URL, secret: env.BOT_WEBHOOK_SECRET, port: env.BOT_WEBHOOK_PORT },
    });
  } else {
    gateway = new GrammyGateway({ logger, mode: 'polling' });
  }
  const worker = new BotWorker({ gateway, api, logger });
  const shutdown = async (sig: string) => {
    logger.info('shutting down', { sig });
    await worker.stop();
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (e) => logger.error('unhandled rejection', { err: (e as Error)?.name }));
  logger.info('bot starting', { mode: env.BOT_FAKE === 'true' ? 'fake' : env.BOT_MODE });
  await worker.run();
}

main().catch((e) => {
  logger.error('fatal', { err: (e as Error).message });
  process.exit(1);
});
