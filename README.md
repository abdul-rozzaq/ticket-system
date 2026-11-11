# TP Ticket System

Internal ticket system for a small technical-support team that answers customers (AmoCRM, Bitrix24, online PBX) in Telegram
groups through one shared account. A userbot reads the customer groups, the API turns messages into tickets, an internal bot
posts cards for the team, the admin panel manages everything, and a Chrome extension helps in Telegram Web.

**Read [docs/status.md](docs/status.md) first:** it says exactly what exists and what has been verified against real
services (so far nothing has touched a real Telegram account or AI provider).

```text
apps/api          NestJS + Prisma 7 + PostgreSQL (pgvector): domain logic, auth, realtime
apps/userbot      GramJS worker: reads customer groups, executes commands (never sends to customers)
apps/bot          grammY internal bot: ticket cards, buttons, reminders
apps/admin        Next.js admin panel (BFF, Uzbek UI)
apps/extension    Chrome extension for Telegram Web (side panel / dock)
packages/shared   zod schemas, masking, peer ids, i18n, SLA
infra/            docker-compose, Dockerfiles, .env.example
docs/             documentation (see docs/README.md)
```

## Quick start

Requirements: Node 22+, pnpm, Docker.

```bash
pnpm install
```

```bash
pnpm --filter @tp/shared build
```

```bash
cp infra/.env.example infra/.env
```

Fill `infra/.env` (secrets, `TG_API_ID`/`TG_API_HASH`), then start everything:

```bash
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d --build
```

- Admin panel: <http://localhost:3001> (login `admin`, password from `SEED_ADMIN_PASSWORD`)
- API and Swagger: <http://localhost:3000>, <http://localhost:3000/docs>

Next: log the userbot in ([docs/guides/userbot.md](docs/guides/userbot.md)), set up the bot
([docs/guides/bot.md](docs/guides/bot.md)), install the extension ([apps/extension/README.md](apps/extension/README.md)).

## Documentation

Everything is in [docs/](docs/README.md): architecture, status, plan, feature list, how-to guides and the manual test checklist.
