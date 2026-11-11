# Progress: done and remaining

Short overview. Details and honest verification state per area: [STATUS.md](../STATUS.md), [FEATURES.md](../FEATURES.md).
Real-service checks still to do by hand: [MANUAL_TESTS.md](../MANUAL_TESTS.md).

## Done

| Area                             | What exists                                                                                                                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0-P2 monorepo, API core         | pnpm workspace, shared package (schemas, i18n uz, masking, SLA, peer ids), NestJS + Prisma + PostgreSQL/pgvector, auth (argon2id, rotating refresh tokens, lockout), users, groups, tickets, templates, audit, Socket.IO |
| P3 userbot + intake              | GramJS userbot worker (adapter unverified), rules prefilter, debounce, AI classification with masking, staff commands, reactions, attribution, auto-assign                                                               |
| P4 internal bot                  | grammY bot (adapter unverified), cards, callbacks, commands, reminders, digest, link codes                                                                                                                               |
| P5 funnel + folders              | Stages, Kanban API, drag and drop move, Telegram folder reconcile (planner, dry run, sync, log, quotas)                                                                                                                  |
| P6 KB + AI drafts                | KB CRUD and approval queue, embeddings + full-text search (RRF), grounded drafts, `.ai`, KB growth from closed tickets, stats                                                                                            |
| Admin API additions              | Audit log, SLA policies, statistics + CSV, settings audit, `patchOf` (PATCH no longer resets defaults), group activation confirms                                                                                        |
| **Admin panel** (`apps/admin`)   | BFF login (httpOnly cookies, CSRF, single-flight refresh), role-based nav, all pages: dashboard, Kanban, tickets, filtered, groups, users, templates, KB, settings, Telegram, AI, statistics, audit                      |
| **Extension** (`apps/extension`) | Server mode: login, ticket card by chat, actions, notes, templates, AI draft, `.ai` over realtime, activity ping, notifications, badge; mock mode kept; 57 unit tests + contract smoke against the real API              |
| Infra                            | Dockerfiles (api, userbot, bot, admin), compose, `.env.example`, CI workflow, pnpm 12 `allowBuilds` fix, `.dockerignore`; admin and api images built, admin container run against the API                                |
| Tests                            | shared 57, userbot 47, bot 26, api unit 68, admin 13, extension 57, api e2e 166 against real PostgreSQL                                                                                                                  |

## Remaining

1. **Extension in a real browser:** load it in Chrome, run MANUAL_TESTS §11 (service-worker lifetime with the websocket, send detection on WebK/WebA, `.ai` round trip), then fix what breaks. Still mock-only: chat-list badges, local reminders/tags.
2. **P8 hardening and extras:** chat-list badges from server data, spec section 12 extras, demo seed (`DEMO_MODE` is parsed but does nothing), `ARCHITECTURE.md`, sweeper for claimed-then-crashed userbot commands, smaller API image (currently ~970 MB), start and test the whole compose stack, run the CI workflow once.
3. **Admin panel gaps:** live updates over WebSocket (pages poll every 15-30 s), Russian dictionary (empty stub), browser e2e tests, per-staff folder status in the users table.
4. **Verification against real services (nothing has touched them yet):** real Telegram account (userbot login, discovery, folder sync, commands), real bot token and internal group, real AI provider (completions and embeddings; tune `kb.maxVectorDistance`), Telegram Web selectors in the extension. Follow MANUAL_TESTS.md sections 1-10.
5. **Open risks:** Telegram ToS/ban risk of the shared userbot account, folder limits (Premium recommended), single API instance assumption (in-process events), panel refresh cache is in-process (sticky sessions when scaling), set `COOKIE_SECURE=true` behind HTTPS.
