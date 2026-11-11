# Admin panel

`apps/admin`: Next.js 16 (App Router) + Tailwind 4, Uzbek UI (dictionary in `src/lib/i18n.ts`).

```bash
pnpm --filter @tp/shared build
```

```bash
pnpm --filter @tp/admin dev
```

Opens on <http://localhost:3001>. Environment: `API_URL` (server-side URL of the API, default `http://localhost:3000`) and
`COOKIE_SECURE=true` when served over HTTPS. Docker image: `infra/Dockerfile.admin` (service `admin` in the compose file).

## Auth model (BFF)

The browser only talks to the panel's own origin.

- Login goes to `/api/auth/login`; the API's token pair is stored in **httpOnly, SameSite=Strict cookies**: page JavaScript never sees a token.
- Every API call goes through `/api/proxy/*`, which adds the bearer token, rotates the refresh token once even for parallel
  requests (single-flight), and refuses `internal/*` routes and path tricks.
- Every mutation must carry the `x-tp-csrf` header (a cross-site form cannot set it).
- There is no forced password change; admins reset passwords on the Users page.

## Pages

Admin: dashboard, Kanban, tickets, filtered messages, client groups, users, templates, knowledge base, settings (funnel,
SLA policies, intake, assignment, reminders, commands, folders, KB), Telegram (userbot login, bot, folders), AI, statistics
(+ CSV), audit log. Staff: dashboard, own tickets, templates and the knowledge base (read-only). The API enforces the roles;
the UI only hides what is not allowed.

Manual checks: [../testing/manual-tests.md](../testing/manual-tests.md) section 10.

## Look and feel (Corporate / Clean)

Light, restrained palette: cool grey surfaces, one deep-blue accent (`--primary`), a navy sidebar, thin borders, almost no
shadows, 6 px radius, tabular numbers. All colours are tokens in `apps/admin/src/app/globals.css` (shadcn naming, with a dark
variant under `.dark`); components in `src/components/ui.tsx` never hard-code colours, so a re-theme is a token change.
The extension panel (`apps/extension/src/ui/styles.css`) uses the same palette.
