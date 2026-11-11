# TP Assistant — Chrome extension prototype

A throwaway-quality **prototype** that injects a support-team toolbox into Telegram Web
(`https://web.telegram.org/k/` and `https://web.telegram.org/a/`). There is no backend: tickets,
clients, templates and the knowledge base are mock data stored in `chrome.storage.local`.
The goal is to find out what is technically possible in Telegram Web, feature by feature.
See [FEATURES.md](FEATURES.md) for the verdict per feature and [MANUAL_TESTS.md](MANUAL_TESTS.md) for the test checklist.

> **Honesty note.** Nothing here has been run against the real Telegram Web (the author could not log in).
> Unit tests cover the pure logic; the content script was smoke-tested in Chromium against a *fake*
> Telegram page (`harness/`). Every Telegram-facing feature is `NOT_TESTED` until you run MANUAL_TESTS.md.

## Hard rules the code follows

1. **Never sends.** The extension only puts text into the composer. It never dispatches Enter, never clicks Send.
   The `;` popup actively *swallows* Enter so Telegram cannot send while it is open.
2. **No data leaves the browser**, except the optional real-LLM call (F9_LLM), which is off by default.
3. All Telegram DOM knowledge lives in [`src/telegram/selectors.ts`](src/telegram/selectors.ts) (fallback lists, separate `/k/` and `/a/` sets).
   All DOM code is fail-soft: null checks, `try/catch`, console warnings prefixed `[TP]`.
4. All injected UI lives in **one Shadow DOM** on a zero-size fixed host. It follows Telegram's light/dark theme.

## Install

```bash
pnpm install
```

```bash
pnpm build
```

Then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, pick the `dist/` folder.
Open (or **reload**) a Telegram Web tab — content scripts are not injected into tabs that were open before install.

Other scripts:

| Command | What it does |
| --- | --- |
| `pnpm dev` | Watch-mode rebuild of all three bundles. No true HMR (MV3 content scripts can't hot-reload): after a rebuild press ↻ on `chrome://extensions` and refresh the Telegram tab. |
| `pnpm test` | Vitest: pure logic + fake-DOM tests. |
| `pnpm typecheck` | `tsc --noEmit` (strict). |
| `pnpm harness` | Serves fake Telegram pages at `http://localhost:5179/k/` and `/a/` with a `chrome.*` stub and the built `dist/content.js`. Useful for UI work without Telegram. Run `pnpm build` first. |

### Build layout

Three Vite builds (see the `vite*.config.ts` files):

1. `vite.config.ts` – options page and side panel (normal multi-page build).
2. `vite.content.config.ts` – the content script as **one IIFE** (`dist/content.js`). MV3 content scripts can't be ES modules.
3. `vite.background.config.ts` – the service worker as **one ES module without code splitting** (`dist/background.js`).
   Service workers forbid dynamic `import()`, and the Anthropic SDK contains lazy imports, so everything is inlined.

`@crxjs/vite-plugin` was not used: a plain config was simpler to reason about with Vite 8 and gives full control over the three output shapes.

## Permissions

| Permission | Why |
| --- | --- |
| `host_permissions: https://web.telegram.org/*` | Inject the content script (dock, overlays, composer insertion) into Telegram Web. Content script `matches` are limited to `/k/*` and `/a/*`. |
| `storage` | Settings, mock tickets/clients/templates/KB, notes, reminders, diagnostics (`chrome.storage.local`). |
| `alarms` | Reminders (F14) and a once-a-minute refresh of the overdue badge on the extension icon. |
| `notifications` | Show reminder notifications (F14). Clicking one focuses Telegram and opens the chat. |
| `sidePanel` | The side-panel variant of the UI (F15). |
| `clipboardWrite` | Last-resort insertion fallback (copy + "press Ctrl+V") and "DOM hisobotini nusxalash". |
| `optional_host_permissions: https://*/*, http://localhost/*, http://127.0.0.1/*` | **Not granted at install.** Requested at runtime for exactly one origin (e.g. `https://api.anthropic.com/*`) when you click "Hostga ruxsat berish" on the options page to enable the real LLM (F9_LLM). The wildcard is only there so any OpenAI-compatible endpoint can be requested. |

No `tabs` permission: the side panel only needs tab ids and the URL of Telegram tabs, which the host permission already covers.

## First run

1. Options page (right-click the icon → *Options*): choose **Men kimman** (Ali / Vali / Sardor). History events are written with this name.
2. Open Telegram Web. A dock appears on the right; **Alt+T** toggles it. Clicking the extension icon toggles it too.
3. **Diagnostika** tab → check the selector table and press **Barcha usullarni sinash** (inserts a marker text into the composer and removes it again; nothing is sent).

## Mapping a real chat to a mock client

Mock tickets belong to 6 mock clients. A real chat is matched to a client by:

1. **Chat id** — the part of the URL after `#` (e.g. `-1001234567890`, `-1234567890`, `@username`). Set it either
   - in the panel: *Tiket* tab → "Chatni mock mijozga bog'lash" → choose client → **Bog'lash** (uses the current chat's id), or
   - on the options page, table "Mock mijozlar ↔ Telegram chatlari".
2. **Title hint** (fallback) — if the chat title contains the client's hint (e.g. `orient`, `textile`, `mebel`), it matches. Editable on the options page.

The chat-list badges (F11) use the same matching.

## Using Diagnostics (Diagnostika tab)

- **Muhit**: detected Telegram version (`/k/` or `/a/`), browser, panel mode.
- **Funksiyalar holati**: every feature flag with a live status — `OK`, `DEGRADED`, `FAILED`, `NOT_TESTED` (not exercised yet in this page session) or `OFF`. Statuses are set only from things the code actually observed (e.g. F6 becomes `OK` only after a verified insertion).
- **Test: yozish maydoniga matn qo'yish**: runs each insertion strategy (`execCommand`, `inputEvent`, `paste`, `clipboard`) against the composer, verifies by reading the composer back, restores the previous text, and remembers the winning strategy per Telegram version.
- **Selektorlar**: self-test of every selector in `selectors.ts`: `found` / `not_found` / `multiple` / `skipped`, with the selector that matched.
- **F7: o'qilgan xabarlar**: what the experimental message reader parsed from the DOM.
- **DOM hisobotini nusxalash**: copies one plain-text report — versions, selector results, parsed message metadata (no text), last insertion test, and trimmed `outerHTML` (≤3 KB each) of the composer, composer wrapper, chat header, one incoming bubble and one chat-list item. **All text nodes are replaced by `[length]`**, and `title/alt/aria-label/href/src/style` values are redacted. Paste it back to the developer to fix selectors.

## Real LLM (F9_LLM, off by default)

Options page → "Haqiqiy LLM": provider (**Anthropic Messages API** via the official `@anthropic-ai/sdk`, or any **OpenAI-compatible** `/chat/completions` endpoint), endpoint, model, API key.
Then **1) Hostga ruxsat berish** (grants the one origin), **2) Ulanishni tekshirish**, then enable the `F9_LLM` flag.

- Default model: `claude-opus-5-5` (change it freely, e.g. `claude-haiku-5-5` for cheaper drafts). Requests use `output_config.effort: "low"` and, for models that support it, server-side refusal fallback (`fallbacks: "default"`).
- The call is made from the background service worker. The key stays in `chrome.storage.local`, is never exported (F18), and is only sent to the configured endpoint.
- What is sent: the masked client message(s) (F13) and the top KB articles. If BM25 finds no relevant article, **no request is made** and the UI says "Bazada topilmadi".
- The system prompt forces answers only from the provided articles, otherwise the model must answer `NOT_FOUND`.
- Latency and token usage are shown under the draft (`model · ms · in/out tokens`) and stored in diagnostics.

## Decisions & assumptions (made without asking)

- **Preact 11 + plain CSS**, one shared stylesheet used both inside the shadow root and in the side panel/options pages.
- **Message hover button (F8) uses an overlay** positioned from `getBoundingClientRect()` with a single delegated `mouseover` listener, instead of injecting a button into every bubble with a MutationObserver. Zero work while scrolling, and Telegram's virtualised list never sees our nodes.
- **Chat-list badges (F11) do inject** small `<span data-tp-badge>` dots into list rows (an overlay would have to track every row while scrolling). Repaint is debounced (300 ms) and ignores mutations caused by our own nodes; cost is shown in Diagnostics.
- **Ctrl+K** opens the palette only when focus is *not* in the composer (Telegram uses Ctrl+K there to insert a link). **Alt+K** always works.
- **BM25 with prefix stemming** (first 5 characters) is a cheap stand-in for real Uzbek/Russian morphology. Relevance threshold `1.5` was tuned on the mock KB only.
- **Card masking** masks Luhn-valid numbers *and* 16-digit numbers with local BINs (8600 Uzcard, 9860 Humo, 5614, 6262) even if Luhn fails — better to over-mask before an AI call.
- **SLA pauses** while a ticket is `WAITING_CLIENT` or `CLOSED`.
- **Mock timestamps are relative**: they are generated relative to install/reset time so SLA timers look live. Options → "Mock'ni tiklash" re-seeds.
- **Navigation to a chat** (reminder notification click, palette ticket item) sets `location.hash = '#<chatId>'` in the Telegram tab. Both clients route on the hash, but whether they react to an external hash change is NOT_TESTED.
- **Side panel theme** follows the OS (`prefers-color-scheme`), not Telegram's in-app theme (the side panel can't read Telegram's DOM without a round trip).
- Mock state writes are read-modify-write on one storage key: fine for 2–3 people on separate browsers (each browser has its own mock state anyway).

## Project layout

```
public/manifest.json         MV3 manifest, icons
src/telegram/selectors.ts    ALL Telegram DOM selectors (k/a), with fallbacks
src/telegram/*.ts            dom helpers, chat detection, composer insertion, message parsing, DOM report
src/content/*                content script: shadow host, dock, inline trigger, chips, hover menu, badges
src/ui/*                     panel + tabs + palette, shared by dock and side panel (via a Bridge interface)
src/background/index.ts      service worker: LLM, alarms, notifications, badge, side panel behaviour
src/options, src/sidepanel   extension pages
src/logic/*                  pure logic (unit-tested): templates, SLA, BM25, masking, tickets, stats, AI prompt
src/mock/*.json              mock staff, clients, tickets, templates, KB
tests/                       Vitest
harness/                     fake Telegram pages + chrome.* stub for local smoke tests (not shipped)
```
