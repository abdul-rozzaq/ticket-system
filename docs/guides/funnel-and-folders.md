# Funnel, Kanban and Telegram folders

- Board: `GET /api/v1/funnel/board` (filters `assigneeId`, `systemType`, `clientGroupId`); drag and drop:
  `POST /api/v1/funnel/move` `{ticketId, to: "NEW" | "WAITING" | "CLOSED" | "USER:<uuid>"}`. "Kechikkan" (overdue) is virtual
  and cannot be a target. Stage titles/order: `GET/PUT /api/v1/funnel/stages`. In the panel: Kanban page.
- Folders (admin; panel: Telegram -> Papkalar): `GET /telegram/folders` (state + last run), `GET /telegram/folders/preview`
  (**dry run**), `POST /telegram/folders/sync` (**sync now**), `GET /telegram/folders/log` (per-operation log).
- Settings (`PUT /api/v1/settings`, panel: Sozlamalar): `funnel.foldersEnabled`, `funnel.staffFolders`,
  `funnel.emptyFolders` (`placeholder` | `remove`), `funnel.reconcileDebounceSeconds`. Env: `FOLDERS_POLL_MS` (periodic full sync,
  default 5 minutes; `0` disables automatic syncs).

The folders are visible to everyone who uses the shared TP account (each person opens their own tab). **Telegram Premium is
recommended** (20 folders / 200 chats per folder instead of 10 / 100). Only folders the system created are ever modified; to
recover from a database restore, delete the old funnel folders by hand and sync again. Telegram rejects empty folders, so
empty funnel folders hold a "Saved Messages" placeholder by default.

The GramJS folder calls have never run against real Telegram: see [../testing/manual-tests.md](../testing/manual-tests.md) section 4.
