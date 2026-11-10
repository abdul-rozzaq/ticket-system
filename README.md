# TP Ticket System

Internal ticket system for a small technical-support team answering customers (AmoCRM, Bitrix24, online PBX) in Telegram
groups through one shared account. **Work in progress: read [STATUS.md](STATUS.md) first** — it says exactly what exists and
what has been verified. Design decisions are in [PLAN.md](PLAN.md); features in [FEATURES.md](FEATURES.md).

```
apps/api          NestJS + Prisma + PostgreSQL(pgvector)   <- implemented (auth, users, groups, tickets, templates, realtime)
apps/userbot      GramJS worker                            <- not started
apps/bot          grammY internal bot                      <- not started
apps/admin        Next.js admin panel                      <- not started
apps/extension    Chrome MV3 extension                     <- prototype still in ../extension, not yet moved
packages/shared   zod schemas, masking, peer ids, i18n, SLA
infra/            docker-compose, Dockerfile.api, .env.example
```

## Local development

Requirements: Node 22+, pnpm, Docker.

```bash
pnpm install
```

```bash
pnpm --filter @tp/shared build
```

Start a throwaway database with pgvector (the same one the e2e tests use):

```bash
docker run -d --name tp-test-pg -e POSTGRES_USER=tp -e POSTGRES_PASSWORD=tp -e POSTGRES_DB=tp_test -p 55432:5432 pgvector/pgvector:pg17
```

```bash
cd apps/api && echo 'DATABASE_URL="postgresql://tp:tp@localhost:55432/tp_test?schema=public"' > .env && pnpm exec prisma migrate deploy && pnpm exec prisma generate
```

Tests:

```bash
pnpm test
```

```bash
pnpm --filter @tp/api test:e2e
```

Run the API (set `JWT_SECRET` ≥ 32 chars, `ENCRYPTION_KEY` = `openssl rand -base64 32`, `SEED_ADMIN_PASSWORD`):

```bash
pnpm --filter @tp/api dev
```

Swagger: `http://localhost:3000/docs`. The seeded admin must change its password at first login.

## Environment variables (API)

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string (pgvector extension required) |
| `JWT_SECRET` | ≥ 32 chars, signs access tokens |
| `ENCRYPTION_KEY` | 32 bytes base64, AES-256-GCM key for secrets at rest |
| `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` | first admin, created when the user table is empty |
| `ACCESS_TTL_SECONDS` (900), `REFRESH_TTL_DAYS` (30) | token lifetimes |
| `LOCKOUT_MAX_FAILURES` (5), `LOCKOUT_WINDOW_MINUTES` (15) | login lockout |
| `CORS_ORIGINS` | `*` or a comma-separated list |
| `SERVICE_TOKEN` | reserved for userbot/bot → API calls |
| `DEMO_MODE` | reserved; demo seed not implemented yet |

## Docker

`infra/docker-compose.yml` defines postgres+pgvector, redis and the api. **It has not been run end to end yet.**

```bash
cp infra/.env.example infra/.env
```

```bash
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d --build
```

Backups: back up the `pgdata` volume (`pg_dump` nightly) and keep `ENCRYPTION_KEY` safe — without it stored secrets
(userbot session, AI keys) cannot be decrypted.
