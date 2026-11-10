# MANUAL TESTS

Everything below touches the real Telegram or real AI providers and therefore **has not been verified** by the
automated tests (which use fakes). Run these before trusting the corresponding feature. Mark each ✅ / ⚠️ / ❌.

> Safety: the system must never send anything to a customer chat on its own. If a message appears in a customer chat
> that no human typed, stop and report it immediately. The only write the userbot performs is **deleting the TP
> account's own `.done`-style command messages**.

## 0. Preparation

1. Create a Telegram app at <https://my.telegram.org> → "API development tools" → note `api_id` / `api_hash`.
2. Use a **throwaway test account** first, not the production TP account (ban risk, see STATUS.md → Open risks).
3. Create two test groups (a normal group and a supergroup) containing the test account and a second "customer" account.
4. Fill `infra/.env` (`TG_API_ID`, `TG_API_HASH`, `SERVICE_TOKEN`, …) and start the stack (or `pnpm --filter @tp/api dev` + `pnpm --filter @tp/userbot dev`).
5. In the API: log in as admin, change the seeded password. Create a staff user.

## 1. Userbot login (admin panel flow → API commands)

The admin panel does not exist yet; use Swagger (`/docs`) with an admin token or `curl`.

| #   | Step                                                                                          | Expected                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | `GET /api/v1/telegram/userbot/status` before login                                            | `status: LOGGED_OUT`, `alive` true once the userbot process heartbeats (≤ 30 s)                                             |
| 1.2 | `POST /telegram/userbot/login/phone {"phone":"+998…"}`                                        | Within ~25 s status becomes `CODE_SENT`; Telegram delivers a login code to the account                                      |
| 1.3 | `POST /telegram/userbot/login/code {"code":"…"}`                                              | `CONNECTED` (or `NEED_PASSWORD` if 2FA is on → `POST …/login/password`)                                                     |
| 1.4 | Wrong code                                                                                    | status `LOGIN_FAILED` with an error; worker keeps running; a second attempt works                                           |
| 1.5 | Restart the userbot container                                                                 | It reconnects by itself with the stored (encrypted) session, status `CONNECTED`, no new code requested                      |
| 1.6 | DB check: `SELECT "sessionEnc" FROM "UserbotSession"`; `SELECT payload FROM "UserbotCommand"` | `sessionEnc` starts with `v1.`; login command payloads are `{"redacted":true}`; no code/password/session anywhere in the DB |
| 1.7 | CLI fallback: `pnpm --filter @tp/userbot login`                                               | Prompts phone/code/2FA, API then reports `CONNECTED`                                                                        |
| 1.8 | Revoke the session from the phone (Settings → Devices → terminate) and wait                   | Status flips to `LOGGED_OUT`/`ERROR` within a minute; no crash loop                                                         |
| 1.9 | `POST /telegram/userbot/logout`                                                               | `LOGGED_OUT`, `hasSession: false`                                                                                           |

## 2. Discovery

| #   | Step                                                                         | Expected                                                                                           |
| --- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 2.1 | `POST /telegram/userbot/discover`, then `GET /client-groups?confirmed=false` | Both test groups listed as **unconfirmed + inactive**; private chats and channels are NOT listed   |
| 2.2 | Check the stored ids in the DB                                               | Supergroup is `c:<id>`, basic group is `g:<id>`                                                    |
| 2.3 | Add the TP account to a new group while running                              | After `discover` (or restart) it appears; nothing is processed from it until an admin activates it |
| 2.4 | `PATCH /client-groups/:id` → `isActive:true`, `systemType`, company          | Messages from that group are now processed                                                         |

## 3. Intake (customer messages)

Send as the **customer account** in the activated group. Watch `GET /tickets` and `GET /filtered-messages`.

| #    | Step                                                                                      | Expected                                                                                                          |
| ---- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 3.1  | `👍`, `rahmat`, `ok`, `спасибо`                                                           | Appear under filtered messages (reasons `EMOJI_ONLY` / `ACKNOWLEDGEMENT`); no ticket                              |
| 3.2  | "Webhook ulanmadi, lidlar tushmayapti"                                                    | After the debounce window (default 25 s) **one** NEW ticket                                                       |
| 3.3  | Send 4 short lines within 10 s                                                            | **One** ticket with all 4 messages                                                                                |
| 3.4  | Further messages while the ticket is open                                                 | Attached to the same ticket, no new ticket, no AI call (check `GET /ai/usage`)                                    |
| 3.5  | Close the ticket, customer writes again                                                   | A **new** ticket with `previousTicketId` set                                                                      |
| 3.6  | "срочно, всё остановилось"                                                                | Ticket created immediately (no debounce) with urgency `HIGH`                                                      |
| 3.7  | Chit-chat ("bugun futbol bormi?") with AI configured                                      | Filtered as `AI_NOT_REQUEST` with the verdict; "create ticket from this" works                                    |
| 3.8  | Send a message containing `parol: Test12345` with AI configured; inspect the provider log | The provider request contains `[PAROL]`, not the password. The ticket in our DB keeps the original text for staff |
| 3.9  | Disable AI / use a wrong key, send a request                                              | Ticket is still created, `needsReview = true` (fail-open)                                                         |
| 3.10 | Stop the API for a minute, send 3 customer messages, start the API                        | Messages arrive afterwards **in order** (userbot backlog); no duplicates                                          |

## 4. Staff commands, reactions, attribution (as the **TP account**)

| #    | Step                                                              | Expected                                                                                                                            |
| ---- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 4.1  | Reply normally to the customer from the TP account                | Stored as OUT; `firstResponseAt` is set on the ticket; SLA deadline moves to the resolution deadline                                |
| 4.2  | Type `.done token yangilandi`                                     | Ticket CLOSED with that solution note; **the command message disappears** from the chat within a few seconds                        |
| 4.3  | Same with setting `commands.deleteAfterUse=false`                 | Ticket closes, message stays                                                                                                        |
| 4.4  | `.wait`, then customer writes                                     | WAITING_CLIENT, then back to IN_PROGRESS/NEW when the customer replies                                                              |
| 4.5  | `.note nimadir` (internal note)                                   | Note stored, **never visible in the chat as a customer-facing message** (the command message is deleted); not counted as a response |
| 4.6  | `.done` sent as a **reply** to an old message                     | The ticket of that old message is affected, not the current open one                                                                |
| 4.7  | Put ✅ on a customer message from the TP account                  | Ticket closes (best effort: Telegram may not deliver reaction updates in large groups; if not, commands remain the reliable path)   |
| 4.8  | Put 👀                                                            | First-response stamped (if setting on)                                                                                              |
| 4.9  | `.ai`                                                             | `ai.requested` is emitted (the draft delivery itself is P6, not built yet)                                                          |
| 4.10 | Attribution: (needs the extension, P7) press Send in Telegram Web | `answeredById` is set with confidence ≥ 0.9; two staff active in the same chat → 0.5                                                |
| 4.11 | Try `.done` typed by the **customer** account                     | Nothing happens (commands are honoured only from the TP account's own outgoing messages)                                            |

## 5. Resilience

| #   | Step                                               | Expected                                                                                                   |
| --- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 5.1 | Kill the network of the userbot for 2 min, restore | `DISCONNECTED` then `CONNECTED`; reconnect with backoff; no crash                                          |
| 5.2 | Trigger many deletes (e.g. 30 `.done` quickly)     | Userbot logs `FLOOD_WAIT, backing off` if Telegram complains and still completes; no process exit          |
| 5.3 | Inspect userbot logs                               | No message text, phone numbers, codes, passwords or session strings anywhere                               |
| 5.4 | Stop the userbot for > 2 min                       | `GET /telegram/userbot/status` shows `alive:false` (alerting to the internal group comes with the bot, P4) |

## 6. AI provider (when keys are available)

| #   | Step                                                         | Expected                                                                                           |
| --- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| 6.1 | `PUT /ai/provider` (Anthropic) + `PUT /ai/settings` (models) | `GET /ai/settings` never shows the key, only `••••` + last 4                                       |
| 6.2 | `POST /ai/test`                                              | `ok:true`; for models that reject parameters (e.g. Sonnet 5.5/Opus 5.5) no 400 about `temperature` |
| 6.3 | Set `monthlyBudgetUsd` very low                              | Calls stop (hard stop); tickets still open (fail-open)                                             |
| 6.4 | OpenAI-compatible provider with a custom base URL            | Classification works; usage table shows tokens                                                     |

## 7. Internal bot (real Telegram Bot API) — NOT verified

The bot code compiles against grammY 1.x and the whole bot ↔ API contract is verified over real HTTP with a fake Telegram
(`pnpm --filter @tp/bot smoke`: 15/15). **The grammY gateway has never talked to Telegram.**

Preparation: create a bot with @BotFather (`/newbot`), create the internal group, add the bot and the staff, find the
group's chat id (e.g. add @RawDataBot temporarily, or open the group in Telegram Web: `-100…`). Then:

```bash
curl -X PUT $API/api/v1/telegram/bot -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' \
  -d '{"token":"<BotFather token>","internalChatId":"-100…","escalationUserId":"<user uuid>"}'
```

| #    | Step                                                                                                                      | Expected                                                                                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 7.1  | Start the bot service; `GET /telegram/bot`                                                                                | `hasToken:true`, `status.alive:true`, `state:CONNECTED`. With a wrong token: `ERROR`, the process keeps retrying (no crash loop)                                                                                               |
| 7.2  | `POST /telegram/bot/test`                                                                                                 | "✅ TP bot ulandi" appears in the internal group within a few seconds                                                                                                                                                          |
| 7.3  | Admin creates a user → `POST /users/:id/telegram-code`; the person sends `/start <code>` to the bot **in a private chat** | "✅ Hisobingiz bog'landi, <name>". Same code again → "Kod noto'g'ri…". Sending `/start <code>` in the group does nothing                                                                                                       |
| 7.4  | A stranger (not linked) sends `/my`, `/free`, or presses a card button                                                    | `/my` and `/free`: no reply at all. Button: alert "Siz xodim sifatida bog'lanmagansiz"                                                                                                                                         |
| 7.5  | Create a ticket (customer message via the userbot, or `POST /tickets`)                                                    | Card in the internal group: 🔴/🟠/🟢 badge, `#number`, company, system, AI summary, quoted text (secrets masked), time, "🔗 Chatni ochish". Buttons: 🙋 Men olaman · 👤 name (open count) per **available** staff · ⏭ Keyinroq |
| 7.6  | **Race**: two staff press 🙋 at the same moment (count down together)                                                     | Exactly one gets it; the other sees an alert "…allaqachon <name> olgan"; the card shows "✅ <name> tomonidan olindi"                                                                                                           |
| 7.7  | Press a staff button (`👤 Vali`) on an unassigned card                                                                    | Assigned to Vali; Vali receives a DM "📌 Sizga #n … tayinlandi" (no DM if you assigned yourself)                                                                                                                               |
| 7.8  | On an assigned card: Boshqaga o'tkazish → pick someone → ⬅️ back                                                          | Menu lists staff; reassignment is recorded; DM to the new person (with the handover note if set via the API)                                                                                                                   |
| 7.9  | ⏳ Kutilmoqda / ✅ Hal bo'ldi on the card; press anything on a closed card                                                | Status changes in the admin API; the closed card has no action buttons; pressing old buttons shows an alert                                                                                                                    |
| 7.10 | ⏭ Keyinroq, then wait                                                                                                     | "10 daqiqaga kechiktirildi"; no "unassigned" reminder for 10 minutes                                                                                                                                                           |
| 7.11 | Leave a ticket unassigned for `reminders.unassignedMinutes` (default 10)                                                  | Reminder in the group **as a reply to the card**; from the 2nd reminder the escalation person is mentioned (tap opens their profile)                                                                                           |
| 7.12 | A ticket past its SLA deadline                                                                                            | One "🔴 … SLA muddati o'tdi" message; no repeats                                                                                                                                                                               |
| 7.13 | Assigned & open for 4 h / waiting for the client 24 h (shorten the settings to test)                                      | DM to the assignee, once per interval; nothing outside the person's working hours / days off (it arrives when they are back)                                                                                                   |
| 7.14 | 09:00 local time on a working day                                                                                         | Each linked person gets one digest DM "Bugun sizda X ta ochiq tiket, Y tasi kechikkan"; none on days off; never twice a day                                                                                                    |
| 7.15 | `/my`, `/stats`, `/free`, `/busy`, `/help` (also `/my@botname`, also inside the group)                                    | `/my` lists tickets with ✅/⏳ buttons that work; `/busy` removes you from new cards; `/stats` numbers match the admin API                                                                                                     |
| 7.16 | Create 10 tickets quickly                                                                                                 | Cards arrive spaced out (≈ 1 per 3 s in a group), no 429 errors in the log; if Telegram does answer 429 the bot waits `retry_after` and retries                                                                                |
| 7.17 | Kill the bot process while a card is "in flight", restart                                                                 | After ≤ 2 min the card is delivered (re-claimed). Look for a **duplicate** card: results are reported before anything is re-sent, but this window is real                                                                      |
| 7.18 | Rotate the bot token via `PUT /telegram/bot`                                                                              | Within ~30 s the bot restarts with the new token without a container restart                                                                                                                                                   |
| 7.19 | Webhook mode (`BOT_MODE=webhook`, public HTTPS URL, secret)                                                               | Updates arrive via the webhook; requests without the secret header are rejected                                                                                                                                                |
| 7.20 | Inspect the bot logs                                                                                                      | No message text, names or tokens                                                                                                                                                                                               |

## 8. Funnel, Kanban and Telegram folders (real Telegram) — NOT verified

The sync logic, the API ↔ userbot contract and every quota/idempotence rule are verified with a fake Telegram that mimics
the documented limits (`test/folders.e2e-spec.ts`, 19 integration tests with the real worker). **The GramJS calls
(`messages.getDialogFilters`, `messages.updateDialogFilter`) have never run against Telegram, and several Telegram rules
below are written from memory** — this is the riskiest part of P5. Use the throwaway account.

Check first with a dry run: `GET /api/v1/telegram/folders/preview` (changes nothing), then `POST /api/v1/telegram/folders/sync`.

| #    | Step                                                                                  | Expected / what to record                                                                                                                                                                                          |
| ---- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 8.1  | Account with 2 hand-made folders; preview                                             | `limits.foreignFolders: 2`, `maxFolders` 10 (20 with Premium — **verify the real numbers**, `premium` flag correct)                                                                                                |
| 8.2  | Create 3 tickets in 3 groups (one unassigned, one assigned to Ali, one waiting); sync | Folders `🆕 Yangi`, `⏳ Kutilmoqda`, `🔴 Kechikkan`, `👤 Ali`, `👤 Vali` appear **at the end/top of the folder bar**; each customer chat is in exactly one of them; your 2 hand-made folders are untouched         |
| 8.3  | Look at the empty folders (`Kechikkan`, `Vali`)                                       | **Key unknown.** Expected: they contain only "Saved Messages" (placeholder). If Telegram rejected the create (FILTER_INCLUDE_EMPTY or similar) the log shows it; then set `funnel.emptyFolders=remove` and re-test |
| 8.4  | Folder titles longer than 12 characters (a user named "Muhammadyusuf")                | Title is cut to 12 characters (`👤 Muhammady`) and accepted. **Check whether emoji count as 1 or 2 characters** (we assume 2 = stricter)                                                                           |
| 8.5  | Sync twice                                                                            | Second run: `plan.ops: []`, nothing changes in Telegram (no flicker, no reordering)                                                                                                                                |
| 8.6  | Assign / close / take tickets; wait ≤ 10 s (5 s debounce)                             | Chats move between folders automatically; closed ticket's chat leaves all funnel folders; a burst of events causes ONE sync (see `GET /telegram/folders/log`)                                                      |
| 8.7  | Break an SLA (set a deadline in the past)                                             | Chat moves to `🔴 Kechikkan` only (not also to the assignee's folder)                                                                                                                                              |
| 8.8  | Delete our `👤 Ali` folder by hand; rename `🆕 Yangi`; drag a chat into it            | Next sync re-creates / renames / removes the extra chat (our folders are managed; hand-edits are reverted). Your own folders are never changed                                                                     |
| 8.9  | Deactivate Ali                                                                        | His open tickets go back to `🆕 Yangi`, `👤 Ali` folder is deleted, his chat appears in `Yangi`                                                                                                                    |
| 8.10 | Fill the account to the folder limit (create hand-made folders), then sync            | Warning "Papkalar limiti…" (Premium recommended); only system folders (or the first ones) are created; staff folders skipped; **no error from Telegram**                                                           |
| 8.11 | Put > 100 chats into one stage (or use many test groups)                              | Warning at 90 %; extra chats cut at the limit; Telegram accepts the folder. **Verify the real per-folder chat limit**                                                                                              |
| 8.12 | A ticket whose group the TP account does not see (left the group)                     | Warning "Chat topilmadi (…)", chat skipped, others still synced                                                                                                                                                    |
| 8.13 | Run sync with the userbot stopped                                                     | `status: USERBOT_OFFLINE`, nothing queued/applied; works again after the userbot is back                                                                                                                           |
| 8.14 | Trigger many operations fast (30 tickets)                                             | `FLOOD_WAIT` is honoured in the userbot log; sync completes; no ban-like errors. **Watch the account for a "too many requests" warning from Telegram**                                                             |
| 8.15 | Crash/restart the API during a sync                                                   | Lock is released with the transaction; next sync starts clean. Check for a half-applied state: it is repaired by the next sync                                                                                     |
| 8.16 | Restore the DB from a backup while folders exist in Telegram                          | `TelegramFolderState` no longer knows our folders → they are **not adopted**: delete the old ones by hand, then sync (duplicate-title folders otherwise)                                                           |
| 8.17 | Kanban via API: `GET /funnel/board`, `POST /funnel/move` (all column types)           | Matches the folders above; moving to `Kechikkan` is rejected; closed tickets cannot be dragged                                                                                                                     |
