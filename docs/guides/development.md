# Local development

Requirements: Node 22+, pnpm, Docker.

```bash
pnpm install
```

```bash
pnpm --filter @tp/shared build
```

## Database

Start a throwaway PostgreSQL with pgvector (the e2e tests use it too):

```bash
docker run -d --name tp-test-pg -e POSTGRES_USER=tp -e POSTGRES_PASSWORD=tp -e POSTGRES_DB=tp_test -p 55432:5432 pgvector/pgvector:pg17
```

Point the API at it and apply the migrations (Prisma 7 does not read `.env` by itself; `prisma.config.ts` loads it via dotenv):

```bash
cd apps/api && echo 'DATABASE_URL="postgresql://tp:tp@localhost:55432/tp_test?schema=public"' > .env && pnpm exec prisma migrate deploy
```

The Prisma client is generated into `apps/api/src/generated` (gitignored). `pnpm test`, `typecheck`, `build` and `dev` of the API
generate it first; to do it by hand: `pnpm --filter @tp/api prisma:generate`.

## Tests

Unit tests of every package (no database needed):

```bash
pnpm test
```

API end-to-end tests against the real PostgreSQL above (run them locally; CI only runs lint, typecheck and unit tests).
Run **one run at a time**: two runs on the same database truncate each other's tables.

```bash
pnpm --filter @tp/api test:e2e
```

One file only:

```bash
cd apps/api && pnpm exec jest --config jest.e2e.config.js --runInBand test/tickets
```

Lint, formatting and types:

```bash
pnpm lint
```

```bash
pnpm typecheck
```

## Run the apps

API (set `JWT_SECRET` ≥ 32 chars, `ENCRYPTION_KEY` = `openssl rand -base64 32`, `SEED_ADMIN_PASSWORD`, `SERVICE_TOKEN` ≥ 16 chars):

```bash
pnpm --filter @tp/api dev
```

Admin panel, extension, userbot and bot: see their guides in this folder.

## Environment files

Each app has an example file; copy it and fill the empty values. The real files are git-ignored.

| Run mode                    | File to create                                         |
| --------------------------- | ------------------------------------------------------ |
| Docker compose (everything) | `infra/.env` from `infra/.env.example`                 |
| API on the host             | `apps/api/.env` from `apps/api/.env.example`           |
| Userbot on the host         | `apps/userbot/.env` from `apps/userbot/.env.example`   |
| Bot on the host             | `apps/bot/.env` from `apps/bot/.env.example`           |
| Admin panel on the host     | `apps/admin/.env.local` from `apps/admin/.env.example` |
| Extension                   | none (the server URL is entered in the options page)   |

The API, userbot and bot read `.env` from their working directory when started locally (`pnpm --filter <app> dev`); in Docker
no file exists and the variables come from compose. `SERVICE_TOKEN` must be identical in the API, userbot and bot.

## Environment variables (API)

| Variable                                                  | Meaning                                                              |
| --------------------------------------------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`                                            | PostgreSQL connection string (pgvector extension required)           |
| `JWT_SECRET`                                              | ≥ 32 chars, signs access tokens                                      |
| `ENCRYPTION_KEY`                                          | 32 bytes base64, AES-256-GCM key for secrets at rest                 |
| `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`             | first admin, created when the user table is empty; works immediately |
| `SERVICE_TOKEN`                                           | ≥ 16 chars, shared secret for userbot/bot -> API calls               |
| `ACCESS_TTL_SECONDS` (900), `REFRESH_TTL_DAYS` (30)       | token lifetimes                                                      |
| `LOCKOUT_MAX_FAILURES` (5), `LOCKOUT_WINDOW_MINUTES` (15) | login lockout                                                        |
| `CORS_ORIGINS`                                            | `*` or a comma-separated list                                        |
| `BOT_POLL_MS`, `INTAKE_POLL_MS`, `FOLDERS_POLL_MS`        | background timers (`0` disables; tests drive them by hand)           |

There is no forced password change: this is an internal system and admins may know the passwords they set. Use a strong
`SEED_ADMIN_PASSWORD` anyway.
