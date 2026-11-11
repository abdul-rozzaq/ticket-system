# TP Ticket System

Internal ticket system for a small technical-support team answering customers (AmoCRM, Bitrix24, online PBX) in Telegram
groups through one shared account. **Work in progress: read [STATUS.md](STATUS.md) first** — it says exactly what exists and
what has been verified. Design decisions are in [PLAN.md](PLAN.md); features in [FEATURES.md](FEATURES.md).

```
apps/api          NestJS + Prisma + PostgreSQL(pgvector)   <- implemented (auth, users, groups, tickets, intake, AI service, userbot outbox)
apps/userbot      GramJS worker                            <- worker/tests done; real MTProto adapter UNVERIFIED
apps/bot          grammY internal bot                      <- worker/tests done; Telegram gateway UNVERIFIED
apps/admin        Next.js admin panel (BFF, uz UI)         <- done (see STATUS.md)
apps/extension    Chrome extension (Telegram Web side panel)  <- server mode done, untested in a real browser
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

### Extension

```bash
pnpm --filter @tp/shared build
pnpm --filter @tp/extension build   # load apps/extension/dist as an unpacked extension
```

Options -> "Tiket serveri": API URL + login. Without a login the extension runs in the old mock mode. See MANUAL_TESTS.md §11.

### Admin panel

```bash
pnpm --filter @tp/shared build
pnpm --filter @tp/admin dev          # http://localhost:3001  (API_URL defaults to http://localhost:3000)
```

Log in with the seeded admin; the panel asks for a new password first. Environment: `API_URL` (server-side URL of the API),
`COOKIE_SECURE=true` when served over HTTPS. The browser only ever talks to the panel origin; session tokens live in httpOnly
cookies and `internal/*` API routes are not reachable through the panel. Docker: `infra/Dockerfile.admin`, service `admin` in the compose file.

## Environment variables (API)

| Variable                                                  | Meaning                                                    |
| --------------------------------------------------------- | ---------------------------------------------------------- |
| `DATABASE_URL`                                            | PostgreSQL connection string (pgvector extension required) |
| `JWT_SECRET`                                              | ≥ 32 chars, signs access tokens                            |
| `ENCRYPTION_KEY`                                          | 32 bytes base64, AES-256-GCM key for secrets at rest       |
| `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`             | first admin, created when the user table is empty          |
| `ACCESS_TTL_SECONDS` (900), `REFRESH_TTL_DAYS` (30)       | token lifetimes                                            |
| `LOCKOUT_MAX_FAILURES` (5), `LOCKOUT_WINDOW_MINUTES` (15) | login lockout                                              |
| `CORS_ORIGINS`                                            | `*` or a comma-separated list                              |
| `SERVICE_TOKEN`                                           | reserved for userbot/bot → API calls                       |
| `DEMO_MODE`                                               | reserved; demo seed not implemented yet                    |

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

## Userbot (TP account)

The userbot has no database: it talks to the API (`SERVICE_TOKEN`) and to Telegram. Create `TG_API_ID`/`TG_API_HASH` at
<https://my.telegram.org>, then either log in from the admin API (`/api/v1/telegram/userbot/login/*`, see MANUAL_TESTS.md §1)
or on the terminal:

```bash
API_URL=http://localhost:3000 SERVICE_TOKEN=... TG_API_ID=... TG_API_HASH=... pnpm --filter @tp/userbot login
```

Run it with `pnpm --filter @tp/userbot dev` (or the `userbot` compose service). `USERBOT_FAKE=true` starts it with an
in-memory fake Telegram client for smoke tests. **Use a throwaway account first; read the ban-risk note in STATUS.md.**

## Internal bot

1. Create a bot with @BotFather and an internal group (bot + staff). Find the group's chat id (`-100…`).
2. As admin: `PUT /api/v1/telegram/bot` with `{"token":"…","internalChatId":"-100…","escalationUserId":"<uuid>"}`
   (the token is stored encrypted and never returned). Start the `bot` service; it fetches the token from the API.
3. Link each person: admin `POST /api/v1/users/:id/telegram-code`, then the person sends `/start <code>` to the bot in a private chat.
4. `BOT_MODE=polling` (default) needs no public URL; `webhook` needs `BOT_WEBHOOK_URL` and `BOT_WEBHOOK_SECRET`.
5. Smoke test of the bot ↔ API contract (fake Telegram, needs a running API on a fresh DB): `pnpm --filter @tp/bot smoke`.

## Funnel, Kanban and Telegram folders

- Board: `GET /api/v1/funnel/board` (filters `assigneeId`, `systemType`, `clientGroupId`); drag & drop: `POST /api/v1/funnel/move`
  `{ticketId, to: "NEW" | "WAITING" | "CLOSED" | "USER:<uuid>"}`. Stage titles/order: `GET/PUT /api/v1/funnel/stages`.
- Folders (admin): `GET /telegram/folders` (state + last run), `GET /telegram/folders/preview` (**dry run**), `POST /telegram/folders/sync`
  (**sync now**), `GET /telegram/folders/log` (per-operation log).
- Settings (`PUT /api/v1/settings`): `funnel.foldersEnabled`, `funnel.staffFolders`, `funnel.emptyFolders` (`placeholder` | `remove`),
  `funnel.reconcileDebounceSeconds`. Env: `FOLDERS_POLL_MS` (periodic full sync, default 5 min; `0` disables automatic syncs).
- The folders are visible to everyone who uses the shared TP account (intended: each person opens their own tab). **Telegram Premium
  is recommended** (20 folders / 200 chats per folder instead of 10 / 100). We only ever modify folders we created; to recover from a
  database restore, delete the old funnel folders by hand and sync again.

## Knowledge base and AI drafts

- KB: `GET/POST/PATCH/DELETE /api/v1/kb`, approval queue `GET /kb?status=DRAFT` + `POST /kb/:id/approve|reject`, `POST /kb/reindex`,
  `GET /kb/stats`, quick search `GET /kb/search?q=` (approved only). Only APPROVED articles ever answer questions.
- Drafts: `POST /api/v1/ai/draft {chatId, messageId?}` -> `{draft, sources, notFound, mode, masked}`; `.ai` typed by staff in a customer chat
  delivers the draft over Socket.IO (`/events`, event `draft.ready`).
- AI configuration (admin): provider, per-task models (`classifyModel`, `draftModel`, `summaryModel`, `embeddingModel`), prompts, monthly
  budget — see `PUT /api/v1/ai/provider` and `PUT /api/v1/ai/settings`. **Embeddings need an OpenAI-compatible provider** (Anthropic has no
  embeddings API; the KB then uses full-text search). The embedding model must return, or be able to shorten to, **1536 dimensions**.
- Settings (`PUT /api/v1/settings`): `kb.topK`, `kb.minRelevance`, `kb.maxVectorDistance` (tune per embedding model), `kb.growthMinNoteChars`.
