# Manual test checklist (real Telegram Web)

Run every section on **both** `https://web.telegram.org/k/` and `https://web.telegram.org/a/` (switch in Telegram's
settings menu, or open the URL directly). Use a test group if possible. Mark each line ✅ / ⚠️ / ❌ and, for anything
not ✅, attach the **DOM hisobotini nusxalash** report (Diagnostika tab) to your feedback.

> Safety: none of these steps should ever send a message. If anything gets sent without you pressing Send, stop and report it — that is a critical bug.

## 0. Install

| # | Step | Expected |
|---|---|---|
| 0.1 | `pnpm install && pnpm build`, load `dist/` unpacked in `chrome://extensions` | No errors on the extension card. Service worker shows "active" or "inactive" (both fine). |
| 0.2 | Reload the Telegram tab, open DevTools console | `[TP] TP Assistant loaded on /k/` (or `/a/`). No red errors from `content.js`. |
| 0.3 | Options page → choose "Men kimman" = your name | Saved instantly (no Save button). |

## 1. Chat detection (F1) and dock (F2)

| # | Step | Expected |
|---|---|---|
| 1.1 | Open a group chat | Dock on the right. Top line: chat title, `guruh`, chat id from the URL. |
| 1.2 | Open a private chat, then a channel, then a forum topic | Kind changes to `shaxsiy` / `kanal` (or `guruh`) / `forum mavzusi` + topic id. Line updates within ~1 s of each switch. |
| 1.3 | Switch chats quickly with the keyboard (Ctrl+↑/↓ or Alt+↑/↓) | Title and id follow, no stale values. |
| 1.4 | Drag the dock by its title bar, resize with the bottom-left corner, collapse with —, reload the page | Position, size and collapsed state are restored. |
| 1.5 | Alt+T twice; click the extension icon | Dock hides/shows. When hidden, a round "TP" launcher appears bottom-right. |
| 1.6 | Switch Telegram between light and dark theme | Dock follows within a moment. |
| 1.7 | Scroll the chat, type, open media viewer, open Telegram's own right sidebar | Telegram behaves normally; no layout breakage, no lag. |

## 2. Composer insertion (F6) — most important

| # | Step | Expected |
|---|---|---|
| 2.1 | Diagnostika → **Barcha usullarni sinash** with an empty composer | Table shows per strategy `ishladi`/`yo'q`. At least `execCommand` or `paste` should be `ishladi`. Composer is empty again afterwards. **Nothing sent.** |
| 2.2 | Note the "Eslab qolingan g'olib" for this client (k / a) | A strategy name, not `clipboard`. |
| 2.3 | Shablonlar → click any template | Text appears in the composer, caret at the end, Send button becomes active. Press Send yourself → message looks exactly like the preview (line breaks, apostrophes, emoji if any). |
| 2.4 | Type "abc" first, then insert a template | Template is appended after "abc". |
| 2.5 | Template preview → **Almashtirish** | Composer content is replaced by the template. |
| 2.6 | Insert a template, then press Ctrl+Z | Telegram's undo removes the inserted text (tells us the insertion went through Telegram's input model). |
| 2.7 | Disable F6 in options, insert a template | Toast "Matn nusxalandi — Ctrl+V bosing"; Ctrl+V pastes it. Re-enable F6. |

## 3. Templates inline trigger (F5)

| # | Step | Expected |
|---|---|---|
| 3.1 | In the composer type `Salom ;web` | Popup above the composer with "Webhook tekshirish" first. |
| 3.2 | Press ↓ / ↑ | Highlight moves; the caret in the composer does **not** move; Telegram does not open "edit last message" (↑ in an empty composer). |
| 3.3 | Press **Enter** | `;web` is replaced by the template. **Message is NOT sent.** |
| 3.4 | Type `;` then Esc | Popup closes; the `;` stays; Telegram does not close the chat on Esc. |
| 3.5 | Type `;` in the middle of a word (`abc;x`) | No popup (trigger needs a space or line start before `;`). |
| 3.6 | Usage counter in Shablonlar shows ×1 for the used template | ✅ |

## 4. Ticket card, actions, notes (F3, F4, F16) and mapping

| # | Step | Expected |
|---|---|---|
| 4.1 | In an unmapped chat → Tiket → choose "Orient Motors" → Bog'lash | Card shows Orient Motors, AmoCRM chip, T-1041, status, assignee, SLA countdown ticking. |
| 4.2 | Men olaman | Status Jarayonda, assignee = you, new history line with your name. |
| 4.3 | Kutilmoqda | SLA shows "mijoz javobi kutilmoqda" (paused). |
| 4.4 | Hal bo'ldi → type a solution → Yopish | Status Yopilgan, "✅ Yechim: …" shown. |
| 4.5 | Reassign via the select | History "→ vali" etc. |
| 4.6 | Add a note and two tags; switch chats and back | Notes/tags are per chat and persist. Notes never appear in the composer. |
| 4.7 | Name a test group "Baraka test" (title hint fallback) | Card shows Baraka Logistics "(nom bo'yicha)" without manual mapping. |

## 5. Side panel (F15)

| # | Step | Expected |
|---|---|---|
| 5.1 | Options → Panel rejimi = Chrome yon paneli. Click the extension icon on the Telegram tab | Side panel opens with the same tabs; dock disappears, "TP" launcher appears. |
| 5.2 | Switch chats in Telegram | Side panel's chat line follows. |
| 5.3 | Side panel → Shablonlar → click a template | **Key question:** does the text land in Telegram's composer while focus is in the side panel? Record which strategy won (Diagnostika). |
| 5.4 | Press Alt+T in the Telegram page | Side panel opens (if Chrome accepts it as a user gesture) — record yes/no. |
| 5.5 | Hover a message → TP → AI javob | Side panel switches to AI tab with that message. |

## 6. Messages, hover actions, chips, AI, masking (F7–F10, F13)

| # | Step | Expected |
|---|---|---|
| 6.1 | Diagnostika → F7 list | Last messages with sender, direction (←/→), time, reply quote. Compare with the chat; note wrong/missing fields. Try a chat with photos, stickers, forwarded messages and replies. |
| 6.2 | Hover an incoming message | Small "TP" button at its top-right; disappears on scroll; no scroll jank. |
| 6.3 | TP → Shu xabar bo'yicha AI javob | AI tab opens with that text, draft from KB if relevant. |
| 6.4 | TP → Shablon bilan javob | Telegram's reply bar appears above the composer (EXPERIMENTAL; record result), Shablonlar tab opens. |
| 6.5 | TP → Tiketga izoh qilish | Tiket tab, note field prefilled with the quoted message. |
| 6.6 | Ask someone to send "webhook ulanmadi, lidlar tushmayapti" | Within ~1 s chips appear above the composer ("Tavsiya: Webhook tekshirish", KB article). Click → inserted. × hides them for that message. |
| 6.7 | Send yourself (from another account) "parol: Qwerty123, karta 8600 1234 5678 9010, +998 90 123 45 67" → AI → Oxirgi xabarlarni olish | Mask preview shows `[PAROL]`, `[KARTA]`, `[TELEFON]`; approval needed before the draft. |
| 6.8 | Ask about something not in the KB ("ob-havo qanday?") | "Bazada topilmadi" — no invented answer. |

## 7. Chat-list badges (F11), palette (F12)

| # | Step | Expected |
|---|---|---|
| 7.1 | After mapping 2–3 chats | Coloured dots next to their titles in the chat list (orange new, blue open, purple waiting, red overdue). Hover → tooltip with ticket id. |
| 7.2 | Scroll the chat list fast; switch folders | Dots stay on the right rows; no flicker; Diagnostika F11 note shows paint time (record the ms with your real chat count). |
| 7.3 | Ctrl+K outside the composer, Alt+K inside it | Palette opens. Ctrl+K inside the composer must still do Telegram's own "insert link". |
| 7.4 | Palette: type "men ol" → Enter | Ticket taken. Type a template name → Enter → inserted. Type "T-104" → choose a mapped ticket → Telegram opens that chat (record whether hash navigation works). |

## 8. Reminders and badge (F14)

| # | Step | Expected |
|---|---|---|
| 8.1 | Eslatma → custom 1 daqiqa | After ~1 min a Chrome notification "Eslatma: <chat>". |
| 8.2 | Switch to another chat and another browser tab, click the notification | Telegram tab is focused and the reminder's chat opens (record whether it really navigates). |
| 8.3 | Extension icon badge | Red number = overdue mock tickets (2 right after a fresh install/reset). |

## 9. Real LLM (F9_LLM), optional

| # | Step | Expected |
|---|---|---|
| 9.1 | Options → enter API key → 1) Hostga ruxsat berish → 2) Ulanishni tekshirish | Chrome permission prompt for exactly one origin; then `OK: … · N ms · in/out token`. |
| 9.2 | Enable F9_LLM, run AI on a webhook message | Draft based only on the KB article; info line shows model, latency, tokens. |
| 9.3 | Run AI on an unrelated message | "Bazada topilmadi", and no new LLM call (token info says LLM not called). |

## 10. Export / import (F18)

| # | Step | Expected |
|---|---|---|
| 10.1 | Options → JSON eksport | File downloads; it contains no API key. |
| 10.2 | Change something, then JSON import of that file | State restored; your API key is kept. |

## 11. Robustness

| # | Step | Expected |
|---|---|---|
| 11.1 | Turn every feature flag off one by one | The corresponding UI disappears; nothing else breaks. |
| 11.2 | Leave Telegram open for an hour with the dock open | No growing memory in Chrome's task manager for the tab beyond Telegram's normal. |
| 11.3 | Diagnostika → DOM hisobotini nusxalash → paste into a text editor | Report contains structure and class names, **no message text or names**. |
