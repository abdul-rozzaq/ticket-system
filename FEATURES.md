# FEATURES

Status: ✅ implemented + automatically tested · 🟡 pure logic only (no Telegram/AI adapter yet) · ⬜ not started.
"Added" = beyond the specification.

| Area | Feature | Status | Notes |
| --- | --- | --- | --- |
| Auth | argon2id login, JWT + rotating refresh, reuse detection, lockout, audit log of logins | ✅ | e2e tested |
| Auth | forced password change, seed admin, deactivation effective immediately | ✅ | |
| Auth | admin panel / extension login screens | ⬜ | |
| Users | create/edit/deactivate, roles, reset password, duty/availability flags, working hours | ✅ API | no UI |
| Users | Telegram link code (hashed, 24 h, single use) | ✅ API | bot side ⬜ |
| Groups | client groups, id normalisation (WebA/WebK/MTProto), by-chat lookup | ✅ API | discovery import method exists, no userbot |
| Tickets | one open per group (DB-enforced), `previousTicketId`, no reopening | ✅ | |
| Tickets | atomic first-press-wins assignment, idempotent for owner | ✅ | 9-way race e2e |
| Tickets | take / assign (+handover note) / wait / close with solution note / internal notes / merge | ✅ API | |
| Tickets | first-response stamping, SLA deadline switch to resolution | ✅ | overdue scheduler ⬜ |
| Templates | CRUD, categories, keywords, usage counter | ✅ API | |
| Realtime | Socket.IO `/events`, JWT handshake, per-user rooms | 🟡 | compiled, not e2e tested |
| Intake | prefilter (emoji/short/ack uz-ru-en, staff), command parser, urgent keywords | 🟡 | pure logic tested; no userbot |
| Intake | AI classification, debounce, FilteredMessage review | ⬜ | |
| Bot | assignment strategies incl. on-duty + suggested assignee | 🟡 | pure logic tested |
| Bot | cards, buttons, reminders, digests, `/my` `/stats` `/free` `/busy` | ⬜ | |
| Funnel | folder diff/limits/degradation, ticket→folder mapping | 🟡 | pure logic tested |
| Funnel | Kanban, MTProto folder sync, dry-run | ⬜ | |
| AI / KB | schema (pgvector, FTS indexes), masking util | 🟡 | service, RAG, drafts ⬜ |
| Extension | real-data integration | ⬜ | prototype in `../extension` |
| Admin | all pages | ⬜ | |
| Ops | health/ready, Swagger, correlation ids, consistent errors, env validation | ✅ | |
| Ops | Dockerfile, compose, CI | 🟡 | never executed |
| Added | login lockout also per IP; refresh-token concurrency guard; `/client-groups/by-chat` and `/tickets/by-chat` for the extension; settings store with typed defaults | ✅ | |
