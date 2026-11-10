import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { UsersService } from '../src/users/users.service';
import { setupApp } from '../src/setup';

export const ADMIN = { username: 'admin', password: 'Admin-pass-12345' };
export const SERVICE_TOKEN = 'test-service-token-1234567890';

export function setTestEnv() {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://tp:tp@localhost:55432/tp_test?schema=public',
    JWT_SECRET: 'test-jwt-secret-test-jwt-secret-1234',
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    SEED_ADMIN_USERNAME: ADMIN.username,
    SEED_ADMIN_PASSWORD: ADMIN.password,
    LOCKOUT_MAX_FAILURES: '5',
    LOGIN_RATE_LIMIT: '1000',
    SERVICE_TOKEN: SERVICE_TOKEN,
    INTAKE_POLL_MS: '0',
    BOT_POLL_MS: '0',
    FOLDERS_POLL_MS: '0', // tests drive processDue() explicitly
  });
}

export interface TestCtx {
  app: INestApplication;
  prisma: PrismaService;
  http: () => ReturnType<typeof request>;
  /** Wipe all rows and re-run the admin seed. */
  reset: () => Promise<void>;
  svc: () => Record<string, string>;
  login: (
    username: string,
    password: string,
  ) => Promise<{ accessToken: string; refreshToken: string; body: any; status: number }>;
}

export async function createTestApp(opts: { classifier?: unknown } = {}): Promise<TestCtx> {
  setTestEnv();
  const { AppModule } = await import('../src/app.module');
  const { IntakeClassifier } = await import('../src/ai/ai.service');
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (opts.classifier) builder = builder.overrideProvider(IntakeClassifier).useValue(opts.classifier);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  setupApp(app);
  await app.init();
  const prisma = app.get(PrismaService);
  const http = () => request(app.getHttpServer());
  return {
    app,
    prisma,
    http,
    svc: () => ({ 'x-service-token': SERVICE_TOKEN }),
    async reset() {
      await prisma.$executeRawUnsafe(
        `TRUNCATE "TicketEvent","TicketMessage","Reminder","Ticket","FilteredMessage","ClientGroup","SlaPolicy","StaffActivity","RefreshToken","LoginAttempt","AuditLog","Template","KbChunk","KbArticle","IntakeBuffer","UserbotCommand","UserbotSession","BotOutbox","FolderOperation","TelegramFolderState","Funnel","AiDraft","AiUsageLog","AiProvider","Setting","User" RESTART IDENTITY CASCADE`,
      );
      await prisma.$executeRawUnsafe(
        `UPDATE "AiSettings" SET "providerId" = NULL, "classifyModel" = '', "draftModel" = '', "summaryModel" = '', "embeddingModel" = '', "prompts" = '{}', "monthlyBudgetUsd" = 50, "hardStop" = true WHERE id = 1`,
      );
      await app.get(UsersService).onApplicationBootstrap();
    },
    async login(username, password) {
      const r = await http().post('/api/v1/auth/login').send({ username, password });
      return {
        accessToken: r.body.accessToken,
        refreshToken: r.body.refreshToken,
        body: r.body,
        status: r.status,
      };
    },
  };
}

/** Admin who already changed the seeded password (so normal endpoints work). */
export async function adminToken(ctx: TestCtx): Promise<string> {
  const first = await ctx.login(ADMIN.username, ADMIN.password);
  const newPassword = 'Changed-pass-12345';
  const r = await ctx
    .http()
    .post('/api/v1/auth/change-password')
    .set('authorization', `Bearer ${first.accessToken}`)
    .send({ currentPassword: ADMIN.password, newPassword });
  return r.body.accessToken as string;
}

export const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
