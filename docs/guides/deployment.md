# Deployment, CI and releases

## Docker compose

`infra/docker-compose.yml` runs PostgreSQL + pgvector, Redis, the API, the userbot, the bot and the admin panel.
It was started end to end (with a fake Telegram) and the services talked to each other; see [../status.md](../status.md).

```bash
cp infra/.env.example infra/.env
```

Fill the secrets (`JWT_SECRET`, `ENCRYPTION_KEY`, `SEED_ADMIN_PASSWORD`, `SERVICE_TOKEN`, `POSTGRES_PASSWORD`,
`TG_API_ID`, `TG_API_HASH`), then:

```bash
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d --build
```

Stop without losing data:

```bash
docker compose -f infra/docker-compose.yml --env-file infra/.env stop
```

- The API container applies migrations (`prisma migrate deploy`) every time it starts.
- Set `COOKIE_SECURE=true` for the admin panel when it is served over HTTPS (otherwise session cookies are not marked Secure).
- Redis is in the compose file but no code uses it yet.

## Backups

Back up the `pgdata` volume (`pg_dump` nightly) and keep `ENCRYPTION_KEY` safe: without it stored secrets (userbot session,
AI keys) cannot be decrypted.

## CI (GitHub Actions)

`.github/workflows/ci.yml`:

- There is **no check job**: lint, typecheck and tests (unit and the API e2e suite) are run locally.
- **images** on every push to `main`: builds and pushes four images (`tp-api`, `tp-userbot`, `tp-bot`, `tp-admin`) through the shared
  workflow [abdul-rozzaq/reusable-workflows](https://github.com/abdul-rozzaq/reusable-workflows) (`docker-build-push.yml`).

Repository settings the images job needs:

| Kind     | Name                                                | Purpose                        |
| -------- | --------------------------------------------------- | ------------------------------ |
| Variable | `DOCKER_REGISTRY_NAME`, `DOCKER_REGISTRY_USERNAME`  | registry host and account      |
| Secret   | `DOCKER_REGISTRY_TOKEN`                             | registry password / token      |
| Secret   | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (optional) | build notification in Telegram |

The images are pushed as `<registry>/<username>/<image>:<sha>` plus `:latest` (main branch).

## Extension releases

`.github/workflows/release-extension.yml` builds the Chrome extension when a tag `vX.Y.Z` is pushed and attaches
`tp-assistant-vX.Y.Z.zip` to a GitHub Release. There is no auto-update; see [../../apps/extension/README.md](../../apps/extension/README.md).
