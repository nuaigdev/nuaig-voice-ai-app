# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

(AGENTS.md matters: this is Next.js 16.2 with breaking changes. Check `node_modules/next/dist/docs/` before using any Next.js API.)

## Commands

```bash
npm run dev              # Next dev server on http://localhost:3000
npm run dev:demo         # same, with NUVA_DEMO=1: generated sample calls, no Retell (login is the same)
npm run build            # production build (also the main type-check)
npm run lint             # eslint (flat config, eslint-config-next; includes react-hooks/set-state-in-effect)
```

The project has no test framework and no tests. Env vars are listed in `.env.example`; copy it to `.env.local`.

## Naming

The product is **NuVA** (always written exactly like that). The vendor is **NuAIg**. Don't write "Nuva".

## Product vs. client (white-labeling)

- **Product level** is identical for every deployment: `src/config/product.ts` (NuVA name, NuAIg vendor info) and `public/brand/` (NuAIg logos).
- **Client level** is per community: `src/clients/<id>.ts`, typed by `src/clients/types.ts`, with assets in `public/clients/<id>/`. Each deployment serves one client, selected by `CLIENT_ID`. `getActiveClient()` in `src/clients/index.ts` reads it on the server only.
- The server layout (`src/app/layout.tsx`) passes the active config to `ClientConfigProvider`, and client components read it with `useClient()`. Don't import `@/clients` (the registry) from client components. Import `@/clients/categories` or types instead, so other clients' configs don't end up in the bundle.
- **Client integrations** live in the client config and must match that client's live Retell agent exactly:
  - `integrations.retell.toolCategories` maps Retell tool names to call categories.
  - Each `knowledgeBase.categories[]` entry is its own Retell knowledge base, whose ID is read from the `RETELL_KB_<KEY>` env var (e.g. `RETELL_KB_MENU`); a document's category is the KB it lives in. All of them must also be linked to the agent's LLM for the agent to use them. Old `[key] ` filename prefixes from the single-KB days are stripped for display only.
  - `departments` is the starting list for Call Routing.
- Never hardcode a client name, logo, category, or department in components. Add it to the config shape instead.

## Architecture

This is an admin console for a Retell AI voice agent. The app has **no database of its own**. Call, department, and knowledge-base data are read from and written to the Retell REST API. Sign-in is not finalized: `src/lib/auth.ts` is an interim single shared account, so keep auth changes behind `requireSession`/`requireAdmin`.

**Single-page client shell.** `src/app/page.tsx` renders only `ConsoleApp`, which contains:
- session restore (`/api/auth/me`) and the login screen
- `AppHeader`: top navigation led by the NuVA wordmark and then the client logo, a sync/refresh button, the theme toggle, and a user menu with Account and Sign out
- `AppFooter`
- view switching through `ViewKey` state; there are no Next routes per view
- the date range shared by Overview and Call Logs

`/api/calls` is fetched after login and on refresh. All filtering and stats then run on the client in `src/lib/callStats.ts`.

**Route handlers (`src/app/api/*`)** all use `runtime = 'nodejs'`. Each starts with `requireSession()` or `requireAdmin()` from `src/lib/auth.ts`, which return a session or a `NextResponse` to return immediately. Reads need a session; mutations (departments POST, knowledge-base POST/DELETE) need the admin role. Retell failures come back as `{ error }` with status 502.

**Auth.** One shared admin account (`CONSOLE_LOGIN_EMAIL` / `CONSOLE_LOGIN_PASSWORD`, defaulting to admin@seaburylife.org / demo@seabury) and an HMAC-signed httpOnly session cookie keyed by `AUTH_SECRET` (required in production). The client checks `canEdit` only to hide controls; the server enforces the role separately.

**`src/lib/retell.ts`** is server-only:
- `retellFetch` applies a timeout and retries on 502/503/504. Pass `{ retry: false }` for calls that aren't idempotent, such as KB uploads.
- `getCallsDashboard(window)` lists only calls whose `start_timestamp` is in the window (`/v3/list-calls` range filter, max `MAX_WINDOW_DAYS`), then fetches each call's detail (`/v2/get-call`, 8 at a time) because the list omits transcripts and tool calls. Details of settled calls are cached in memory per call ID, so refreshes only fetch new calls. It then flattens them into `FlatCallRow` and builds the summaries. Tool names come from `tool_calls` or, failing that, `transcript_with_tool_calls`.
- `/api/calls?from=&to=` (epoch ms, parsed by `lib/callWindow.ts`) removes `cost_usd` before responding (`CallRow = Omit<FlatCallRow, 'cost_usd'>`). `/api/calls/export` (admin-only, because its Summary sheet has costs) builds the Excel workbook in memory (`lib/excel.ts`). Nothing is written to disk.
- `/api/download-recording?call_id=` looks the call up and streams the recording URL Retell reports for it, and only for this client's `AGENT_ID`. It never fetches a URL supplied by the browser.
- The department list is written to the agent LLM's single `transfer_call` tool as one `inferred` destination with a generated prompt (`syncDepartmentTransfers`). `getLiveRouting` parses that prompt back (`parseTransferPrompt`), so the line format in `buildTransferPrompt` must stay parseable. A tool set up elsewhere comes back as `unmanaged`, and Call Routing requires an explicit opt-in before overwriting it.
- `retellFetch` also retries 429s, honoring `Retry-After`.
- After a KB upload, the code polls `get-knowledge-base`, because Retell's add response is stale.
- Retell refuses to delete a KB's last source; `deleteKnowledgeBaseSource` turns that into "upload the replacement first" (`KB_LAST_SOURCE_MESSAGE`).

**Demo mode** (`src/lib/demo.ts`). `isDemoMode()` requires both `NODE_ENV === 'development'` and `NUVA_DEMO=1`, so it can never turn on in a production build. Every data route handler checks it before calling Retell (sign-in is unchanged):
- `/api/calls` runs generated `RetellRawCall` fixtures through `buildCallsDashboard` (the same pipeline as live data)
- the knowledge base is an in-memory store
- department sync is a no-op

When you add a route that touches Retell, add a demo branch as well.

**Time zones** (`src/lib/time.ts`). Days, charts and timestamps use the client's `timezone`, not the viewer's browser. `DateRange` values are calendar dates, compared with calls via `YYYY-MM-DD` day keys (`dayKeyInTz`). The client fetches `dataWindow(range)` (the range, its comparison period, and the chart's minimum week) padded by `fetchBounds`, and exports use `exactBounds`. Always pass `tz` to the `callStats` range helpers.

## UI conventions

- **Styling.** Plain CSS in `src/app/globals.css`, using design tokens on `:root` and overrides under `[data-theme='dark']`. Light is the default. The theme is stored in localStorage (`src/lib/theme.ts`) and applied before paint by an inline script in the layout; `useTheme` reads it with `useSyncExternalStore`.
- Use tokens (`--brand`, `--surface`, `--tone-*`, …), never raw colors. Config `Tone` keys map to `--tone-<key>`; use `toneVar()` from `components/ui.tsx`.
- **Components.**
  - Icons: `components/icons.tsx` (`<Icon name=…>`). Config files refer to icons by `IconName`.
  - Brand marks: `ClientLogo`, `NuaigLogo`, `NuvaMark` in `components/brand.tsx`. Light/dark logo variants are both rendered and swapped in CSS.
  - Page building blocks: `PageHeader`, `Card`, `ErrorState`, `InlineError` in `components/ui.tsx`.
  - Charts are hand-rolled SVG in `components/charts.tsx`.
