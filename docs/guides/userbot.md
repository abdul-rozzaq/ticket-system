# Userbot (the TP Telegram account)

The userbot has no database: it talks to the API (`SERVICE_TOKEN`) and to Telegram (MTProto via GramJS). It reads customer
groups and executes commands from the API outbox. **It never sends anything to a customer chat**; the only write it performs
is deleting the TP account's own command messages (`.done`, `.ai`, ...).

> **Use a throwaway Telegram account first.** A userbot on the shared TP account can get it limited or banned
> (see "Open risks" in [../status.md](../status.md)). The GramJS adapter has never run against real Telegram.

1. Create a Telegram app at <https://my.telegram.org> -> API development tools and put `TG_API_ID` / `TG_API_HASH` into `infra/.env` (Docker) or `apps/userbot/.env` (local, see `apps/userbot/.env.example`).
2. Start the stack (or `pnpm --filter @tp/userbot dev` next to a running API).
3. Log in, either in the admin panel (Telegram -> Userbot: phone, code, 2FA password) or on a terminal:

```bash
API_URL=http://localhost:3000 SERVICE_TOKEN=... TG_API_ID=... TG_API_HASH=... pnpm --filter @tp/userbot login
```

4. Panel -> Client groups -> "Userbot orqali qidirish" finds the groups of the account; they appear as **unconfirmed and
   inactive**. Nothing is processed from a group until an admin activates it.

The session is stored encrypted (AES-256-GCM) by the API; login codes and passwords are never written to the database or logs.
Commands claimed by a userbot that then died are failed or re-queued after 5 minutes.

Step-by-step checks: [../testing/manual-tests.md](../testing/manual-tests.md) sections 1-3.
