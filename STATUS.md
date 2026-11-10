# STATUS

Legend: ✅ done and verified automatically · 🟡 code written, NOT verified against the real service · ⬜ not started

Last verified run: `pnpm test` (shared 33 + api unit 47) and `pnpm --filter @tp/api test:e2e` (23 e2e against a real
PostgreSQL 17 + pgvector in Docker) were all green.

| Phase | State | What exists | What is missing / not verified |
| --- | --- | --- | --- |
| P0 monorepo / shared / infra / CI | ✅ mostly | pnpm workspace, TS 5.9, ESLint+Prettier config, `@tp/shared` (masking, peer-id normalisation, i18n `uz`, zod schemas, SLA math), `infra/docker-compose.yml` (postgres+pgvector, redis, api), `Dockerfile.api`, `.env.example`, GitHub Actions (lint, typecheck, test, e2e, image push) | **Dockerfile.api was never built** and the full `docker compose up` was never run (only `docker compose config` validated). `pnpm lint` (eslint+prettier) was never run. CI workflow never executed. |
| P1 auth / users / audit | ✅ API · ⬜ UI | argon2id, access JWT + rotating refresh tokens with reuse detection and concurrency-safe rotation, DB-backed lockout, forced password change, roles guard (DB lookup per request so deactivation is immediate), audit log, seed admin from env, AES-256-GCM `CryptoService`, Telegram link codes (stored hashed), consistent error format + correlation ids, health endpoints, Swagger at `/docs` | Admin panel shell + login, extension login: **not started**. Link-code consumption endpoint for the bot is a service method only (no service-token HTTP route yet). |
| P2 groups / tickets / SLA / templates | ✅ API · ⬜ UI | client groups with Telegram id normalisation (WebA `-100…`, WebK `-…`, MTProto), tickets (one open per group via partial unique index, `previousTicketId` chain, first-response stamping, SLA deadline moves to resolution after first response, WAITING→IN_PROGRESS on client reply, merge, handover notes, internal notes), **atomic first-press-wins assignment** (9-way race e2e), templates CRUD + usage counter, settings store, Socket.IO `/events` gateway (JWT handshake), typed in-process domain events | Gateway is built but has **no e2e test** (only compiled). No SLA-breach/overdue scheduler yet (needs BullMQ, P4). Kanban/funnel endpoints not built. |
| P3 userbot / intake | 🟡 pure logic only | `intake-rules.ts` (prefilter: emoji/short/ack uz-ru-en, staff messages, stop words; command parser `.done/#done/.wait/.note/.ai`; urgent keywords) — unit tested | **GramJS worker, login flow, discovery, listening, debounce, AI classification, outgoing detection, reactions, activity-ping attribution: not started.** |
| P4 internal bot | 🟡 pure logic only | `assignment.ts` (MANUAL, FIXED_OWNER, ROUND_ROBIN, LEAST_LOADED, ON_DUTY with working hours in time zone, suggested assignee) — unit tested | **grammY bot, cards, inline buttons, linking command, reminders, digests, `/my` `/stats` `/free` `/busy`: not started.** |
| P5 funnel / folders | 🟡 pure logic only | `folders.ts`: desired-state diff (create/update/delete), idempotence, quota-based degradation to system folders, chat-limit truncation + warnings, ticket→folder mapping — unit tested | MTProto application of the plan, `TelegramFolderState` persistence, reconcile job, Kanban API/UI, dry-run/sync endpoints: **not started.** |
| P6 AI / KB | ⬜ | Prisma models (`AiProvider`, `AiSettings`, `AiUsageLog`, `KbArticle`, `KbChunk` with `vector(1536)` + HNSW index, FTS index), masking util in `@tp/shared` | `AiService`, provider adapters, settings/usage endpoints, RAG, `/ai/draft`, KB growth: **not started.** |
| P7 extension integration | ⬜ | The prototype still lives in `../extension` (untouched) | Not moved to `apps/extension`, not connected to the API. Peer-id normalisation (shared, tested) is ready for it. |
| P8 stats / hardening / docs / demo | ⬜ | Docs: README, PLAN, STATUS, FEATURES | Stats, extras from spec §12, demo seed, ARCHITECTURE.md, MANUAL_TESTS.md: not written. |

## Honest summary

About one quarter of the specification exists: the backend core (auth, users, groups, tickets, assignment, templates,
realtime) is real and tested; the three Telegram-facing processes, the AI subsystem, the admin panel and the extension
integration are **not built**. Nothing here has touched a real Telegram account.

## Open risks

1. **Telegram ToS / ban risk.** Running a userbot (MTProto automation) on the single shared TP account can get it
   limited or banned, and the whole workflow depends on it. Mitigations: conservative rate limits, honour `FLOOD_WAIT`,
   never send automatically, keep the account's phone/2FA recoverable, consider Telegram Premium.
2. **Folder limits** (10 folders / 100 chats per folder, 20 / 200 with Premium). Logic degrades to system folders only
   and warns (tested); recommend Premium for the TP account.
3. **Telegram Web DOM drift** for the extension. Selectors stay isolated in `selectors.ts`; the diagnostics report is the repair loop.
4. **AI cost / privacy.** Masking before every call, budget hard stop, fail-open classification (not built yet).
5. **Shared-account attribution** of who answered is heuristic (extension ping within seconds) and will be wrong sometimes.
6. **Single-instance assumptions.** Domain events are in-process; the bot/userbot will need Redis/BullMQ fan-out (planned).
