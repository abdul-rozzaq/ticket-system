# Knowledge base and AI drafts

AI provider and keys exist **only on the server** (stored encrypted, shown only as the last 4 characters). The extension has
no AI settings; it asks the server for drafts. Secrets in customer text are masked before any provider call.

## Knowledge base

- Panel: Bilim bazasi. API: `GET/POST/PATCH/DELETE /api/v1/kb`, approval queue `GET /kb?status=DRAFT` and
  `POST /kb/:id/approve|reject`, `POST /kb/reindex`, `GET /kb/stats`, quick search `GET /kb/search?q=` (approved only).
- **Only APPROVED articles ever answer questions.** Closing a ticket with a solution note creates a DRAFT article for an admin to approve.
- Settings (`PUT /api/v1/settings`): `kb.topK`, `kb.minRelevance`, `kb.maxVectorDistance` (tune per embedding model),
  `kb.growthMinNoteChars`.

## AI configuration (admin)

Panel: AI. API: `PUT /api/v1/ai/provider` and `PUT /api/v1/ai/settings`: provider (Anthropic or OpenAI-compatible), per-task
models (`classifyModel`, `draftModel`, `summaryModel`, `embeddingModel`), prompts, monthly budget with hard stop.

**Embeddings need an OpenAI-compatible provider** (Anthropic has no embeddings API; the KB then uses full-text search). The
embedding model must return, or be able to shorten to, **1536 dimensions**. Current Claude models reject a custom
`temperature`, so the Anthropic adapter never sends it.

## Drafts

`POST /api/v1/ai/draft {chatId, messageId?}` returns `{draft, sources, notFound, mode, masked}`. If nothing relevant is in the
knowledge base, `notFound` is true and **no answer is invented**. Typing `.ai` in a customer chat (as staff) delivers the draft
over Socket.IO (`/events`, event `draft.ready`) to the extension. Nothing is ever sent to the customer automatically.

No real AI request has ever been made by this system: [../testing/manual-tests.md](../testing/manual-tests.md) sections 5, 6 and 8.
