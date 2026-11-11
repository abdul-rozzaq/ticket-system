# TP Assistant (Chrome extension)

Side panel / dock for Telegram Web (`web.telegram.org/k/` and `/a/`) that shows the ticket of the open customer chat and helps
the support team answer. **All data comes from the ticket server** (tickets, templates, knowledge base, AI drafts); the
extension stores only UI preferences and the login session. Without a login the panel only shows a login shortcut and the
diagnostics tab.

## Build and load

```bash
pnpm --filter @tp/shared build
pnpm --filter @tp/extension build      # output: apps/extension/dist
```

Chrome -> `chrome://extensions` -> Developer mode -> Load unpacked -> choose `apps/extension/dist`.
Then Options -> "Tiket serveri": API URL (e.g. `http://localhost:3000`), login, password. Chrome asks for permission to reach
exactly that host.

## What it does

See [docs/features.md](../../docs/features.md) (Extension rows) and [docs/testing/manual-tests.md](../../docs/testing/manual-tests.md) section 11 for what is verified. In short: ticket card and
actions, internal notes, server templates (`;` quick trigger, palette Ctrl+K), AI drafts (button, message menu or `.ai` in
the chat), suggestion chips, chat-list status dots, notifications and badge, activity ping when a human presses Send.

## Rules the code keeps

- It **never sends** a message: it only fills the composer, and only listens to the human's Send.
- AI keys do not exist here: drafts are made by the server.
- Tokens live in the background service worker and `chrome.storage.local` (readable by extension contexts, not by page
  scripts); panels and content scripts call the API only through the worker (`TP_API`, `internal/*` refused).
- Telegram DOM access is isolated in `src/telegram/selectors.ts`; everything the content script renders sits in one shadow root.

## Layout

```text
src/background/   service worker: session + API proxy, realtime (Socket.IO), notifications, badge, side panel
src/server/       session/refresh logic (unit-tested), API types
src/content/      injected UI: dock, chips, ';' trigger, message menu, chat-list dots, activity ping
src/ui/           panel, tabs (ticket, templates, AI, diagnostics), palette, data hooks
src/telegram/     DOM access: selectors, composer, chat watcher, message reader
src/options/      options page (login, panel mode, zoom, feature flags)
harness/          static fake Telegram pages for DOM experiments (dev only)
```

`pnpm --filter @tp/extension test` runs the unit tests (session/refresh, badges, helpers, DOM parsing).

## Release from GitHub

Push a tag and GitHub builds the extension and attaches it to a Release (`.github/workflows/release-extension.yml`):

```bash
git tag v0.2.0
git push origin v0.2.0
```

The tag must look like `v1.2.3`; it becomes the extension version. Install: download `tp-assistant-v0.2.0.zip` from the
Release, unzip, open `chrome://extensions`, enable Developer mode, **Load unpacked**, choose the unzipped folder.
There is no auto-update: to update, download the new zip and reload the extension (or replace the folder and press reload).
