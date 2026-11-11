# Internal bot

The bot posts ticket cards (with buttons) in the internal staff group, handles `/` commands and sends reminders. It holds no
domain logic: it long-polls the API outbox over HTTP (`SERVICE_TOKEN`).

1. Create a bot with @BotFather and an internal group containing the bot and the staff. Find the group's chat id (`-100…`).
2. In the admin panel (Telegram -> Ichki bot) or with the API: `PUT /api/v1/telegram/bot` with
   `{"token":"…","internalChatId":"-100…","escalationUserId":"<uuid>"}`. The token is stored encrypted and never returned.
   The `bot` service fetches it from the API.
3. Link each person: Users -> edit -> Telegram link code (or `POST /api/v1/users/:id/telegram-code`); the person sends
   `/start <code>` to the bot in a **private** chat.
4. `BOT_MODE=polling` (default) needs no public URL; `webhook` needs `BOT_WEBHOOK_URL` and `BOT_WEBHOOK_SECRET` (16+ chars).

Contract smoke test of bot <-> API over real HTTP (fake Telegram, needs a running API on a fresh database):

```bash
pnpm --filter @tp/bot smoke
```

The grammY adapter has never run against the real Bot API. Checks: [../testing/manual-tests.md](../testing/manual-tests.md) section 7.
