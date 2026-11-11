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
5. In the panel: log in as admin. Create a staff user (the password you set works immediately).

## 1. Userbot login (admin panel flow → API commands)

Use the admin panel (Telegram -> Userbot) or, equivalently, Swagger (`/docs`) with an admin token or `curl`.

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

## 9. Knowledge base, embeddings and AI drafts (real providers) — NOT verified

Everything here is verified only with fake AI adapters (`test/kb.e2e-spec.ts`, `test/draft.e2e-spec.ts`: 36 tests). **No real
Anthropic / OpenAI-compatible request (completion or embedding) has ever been made.** Thresholds were tuned on the 13-article
mock KB only. Start with a small real KB (10-30 articles you trust) and a throwaway provider key with a low budget.

| #    | Step                                                                                                                 | Expected / what to record                                                                                                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9.1  | `PUT /ai/provider` (Anthropic) + `draftModel`; ask `POST /ai/draft` for a chat whose last message matches an article | `mode: "llm"`; the draft is in the customer's language, 1-4 sentences, only facts from the article. **Read the usage table**: tokens and cost per draft                                              |
| 9.2  | Ask about something that is NOT in the KB but sounds plausible (a menu path, a setting)                              | `notFound: true` (no LLM call at all when retrieval finds nothing; if retrieval finds a weak match, the model must answer `NOT_FOUND`). **Try hard to make it invent an answer** and record failures |
| 9.3  | A customer message containing a password, token, card number, phone                                                  | Provider-side log (or a proxy) shows `[PAROL]`, `[TOKEN]`, `[KARTA]`, `[TELEFON]`, never the originals. `masked.text` in the response is exactly what was sent                                       |
| 9.4  | Compare drafts for models of different sizes (`draftModel`)                                                          | Pick the cheapest model that stays grounded; Claude Opus/Sonnet 5.x reject `temperature`, the adapter never sends it                                                                                 |
| 9.5  | OpenAI-compatible provider + `embeddingModel` (e.g. `text-embedding-3-small`); approve an article                    | Chunks get vectors (`SELECT count(*) FROM "KbChunk" WHERE embedding IS NOT NULL`). **Check the model really returns/accepts 1536 dimensions** (other sizes are refused and fall back to full-text)   |
| 9.6  | Vector search quality: paraphrased questions with few shared words; unrelated questions                              | Paraphrases are found (`via: vector`/`both`), unrelated ones are not. **Tune `kb.maxVectorDistance`** (default 0.45 is a guess; real cosine distances depend on the model)                           |
| 9.7  | Anthropic provider with an `embeddingModel` set                                                                      | No embedding calls, no errors, full-text search only (Anthropic has no embeddings API)                                                                                                               |
| 9.8  | Full-text search on your real KB (uz / ru / mixed, typos, endings)                                                   | Right article first for typical questions. Record misses: the 5-character prefix match and the relevance guard (>= 2 matching terms) are crude; tune `kb.minRelevance` or expand articles' tags      |
| 9.9  | `.ai` in a customer chat (userbot running, extension not yet integrated: connect a Socket.IO client to `/events`)    | `draft.ready` arrives only for the person who pressed Send in that chat shortly before (extension ping), otherwise for all staff; the `.ai` message disappears from the chat                         |
| 9.10 | Send the draft unchanged / edited / ignore it; then `GET /kb/stats`                                                  | `sentUnchanged` / `sentEdited` follow within seconds; unrelated messages do not count; a draft older than 30 min is never matched                                                                    |
| 9.11 | Close tickets with real solution notes                                                                               | A DRAFT article appears (AI or extractive); check it contains **no customer names, phone numbers, links or secrets** (the AI is told to generalise, extractive only masks secret patterns)           |
| 9.12 | Approve / edit / reject drafts in the queue (`GET /kb?status=DRAFT`)                                                 | Only approved articles answer questions; an edited approved article answers with the new text immediately; rejected ones vanish from every search path                                               |
| 9.13 | Exhaust the monthly budget                                                                                           | Drafts fall back to the article text (`mode: extractive`, warning), embedding calls stop, tickets are still created                                                                                  |

## 10. Admin panel (browser)

Prerequisites: API + panel running, one admin, one staff user, 2 client groups, a few tickets.

| #     | Step                                                                                                  | Expected                                                                                                                |
| ----- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 10.1  | Open the panel while logged out                                                                       | Redirect to `/login`                                                                                                    |
| 10.2  | Log in as a new user                                                                                  | Asked for a new password (10+ chars), then lands on the dashboard                                                       |
| 10.3  | As STAFF open `/users`, `/board`, `/settings`                                                         | Redirected to the dashboard; nav shows only dashboard, my tickets, templates, KB; KB has no edit buttons                |
| 10.4  | In DevTools, `document.cookie`                                                                        | No session cookie visible (httpOnly)                                                                                    |
| 10.5  | Wait until the access token expires (15 min) and click around                                         | No logout; exactly one refresh happens (network tab), pages keep working                                                |
| 10.6  | Drag a card to a staff column / Kutilmoqda / Yopilgan; drag to Kechikkan                              | Assigned / waiting / asks for the solution note; Kechikkan refuses                                                      |
| 10.7  | Ticket page: take, assign with handover note, wait, internal note, close, merge into another number   | Each shows in the events list and in the audit log; the Telegram card (if the bot runs) is edited                       |
| 10.8  | Client groups: edit only the company name of an inactive group                                        | It stays inactive and keeps language and system                                                                         |
| 10.9  | Groups: "Userbot orqali qidirish" with a running userbot, then "Faollashtirish" on a discovered group | Group appears under "Tasdiqlanmagan", becomes confirmed and active                                                      |
| 10.10 | Users: create, reset password, generate a Telegram link code, deactivate                              | New user can log in with the given password; the code is shown once; deactivated user is logged out on the next request |
| 10.11 | Settings: change a value, reload                                                                      | Value persists; audit log has `settings.update` with from/to                                                            |
| 10.12 | Telegram -> Papkalar: preview, then sync (real account)                                               | Plan matches reality; folders appear in Telegram; second sync reports no changes                                        |
| 10.13 | AI: save provider + key, "Ulanishni tekshirish"                                                       | Success toast with latency; the key is never shown again (only the last 4 characters)                                   |
| 10.14 | Statistics: export CSV, open it in Excel                                                              | Uzbek letters correct; a summary starting with `=` is shown as text, not evaluated                                      |
| 10.15 | Phone-sized window                                                                                    | Menu collapses behind the burger button; tables scroll inside their card                                                |

## 11. Extension in server mode (real Chrome + Telegram Web)

Prerequisites: API running, a staff user whose password was already changed in the admin panel, the TP group registered (and active) in the panel, `pnpm --filter @tp/extension build`, load `apps/extension/dist` unpacked.

| #     | Step                                                                                                                                              | Expected                                                                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 11.1  | Options -> Tiket serveri: enter the API URL and log in                                                                                            | Browser asks for host permission; "Ulangan: <name>"; wrong password shows an error                                                      |
| 11.2  | Open a registered client group in Telegram Web                                                                                                    | Panel shows company, system, ticket number, status, assignee, SLA; header says the group name                                           |
| 11.3  | Open an unregistered chat                                                                                                                         | "Bu chat mijoz guruhi sifatida ro'yxatdan o'tmagan"                                                                                     |
| 11.4  | Press "Men olaman" in two browsers (two staff) nearly together                                                                                    | Exactly one wins; the other sees "Boshqa xodim allaqachon oldi"                                                                         |
| 11.5  | Wait / resume / close with a solution note; add an internal note                                                                                  | Events appear in the panel and the admin panel; the note is NOT sent to the customer                                                    |
| 11.6  | Change the ticket in the admin panel while the extension panel is open                                                                            | Extension view refreshes within ~1 s (realtime) or at most 20 s (polling)                                                               |
| 11.7  | Templates tab: insert a template with variables                                                                                                   | Text appears in the composer (not sent); `{mijoz_nomi}`, `{tizim}`, `{xodim}` filled; usage counter goes up                             |
| 11.8  | AI tab -> "AI javob" on a chat whose question is in the KB; then on an unrelated question                                                         | Draft with sources; second case "Bazada topilmadi" and no invented answer; masked preview shows `[PAROL]` etc. when secrets are present |
| 11.9  | Type `.ai` in the group (as staff)                                                                                                                | The command message is deleted by the userbot, the AI tab opens with the draft within a few seconds                                     |
| 11.10 | Send the draft unchanged / edited                                                                                                                 | KB stats in the panel count it as unchanged / edited; attribution shows YOUR name (activity ping)                                       |
| 11.11 | Press Enter on an EMPTY composer, and use Shift+Enter                                                                                             | No ping is sent (network tab of the service worker)                                                                                     |
| 11.12 | Leave the worker idle for 10+ minutes with the websocket open                                                                                     | Realtime keeps working (the worker stays alive) or reconnects within ~15 s; badge keeps updating                                        |
| 11.13 | Assign a ticket to yourself from the admin panel                                                                                                  | Chrome notification "Sizga tiket #N biriktirildi"                                                                                       |
| 11.14 | Log out in Options / deactivate the user in the admin panel                                                                                       | Panel falls back to mock mode / login; no realtime connection remains                                                                   |
| 11.15 | Chat list while logged in: a group with an open ticket gets a coloured dot (new orange, open blue, waiting purple, overdue red); close the ticket | Dot appears within ~30 s (or ~1 s via realtime) and disappears after closing; works in both /k/ and /a/                                 |
