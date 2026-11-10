import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';
import { setupApp } from './setup';

async function bootstrap() {
  const env = loadEnv(); // fail fast with a readable message on bad config
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  (app as unknown as { set(k: string, v: unknown): void }).set('trust proxy', 1);
  setupApp(app, { swagger: true, corsOrigins: env.CORS_ORIGINS });
  await app.listen(env.PORT, '0.0.0.0');
  new Logger('Bootstrap').log(`API listening on :${env.PORT} (docs at /docs)`);
}

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});
