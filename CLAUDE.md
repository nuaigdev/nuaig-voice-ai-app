# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

(AGENTS.md matters: this is Next.js 16.2 with breaking changes. Check `node_modules/next/dist/docs/` before using any Next.js API.)

## Commands

```bash
npm run dev              # Next dev server on http://localhost:3000
npm run dev:demo         # same, with NUVA_DEMO=1: sample data + demo login demo@nuva.dev / nuva-demo, no Supabase/Retell
npm run build            # production build (also the main type-check)
npm run lint             # eslint (flat config, eslint-config-next; includes react-hooks/set-state-in-effect)
npm run supabase:start   # local Supabase in Docker (API :54321, Studio :54323); required for login
npm run supabase:stop
npm run create-account -- "you@x.com" "password" admin   # role is admin|user; creates or updates the account
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
  - `knowledgeBase.categories[].key` is stored as a `[key] ` filename prefix on Retell KB sources, so renaming a key orphans existing uploads.
  - `departments` is the starting list for Call Routing.
- Never hardcode a client name, logo, category, or department in components. Add it to the config shape instead.

## Architecture

This is an admin console for a Retell AI voice agent. The app has **no database of its own**. Call, department, and knowledge-base data are read from and written to the Retell REST API on every request. Supabase is used only for authentication.

**Single-page client shell.** `src/app/page.tsx` renders only `ConsoleApp`, which contains:
- session restore (`/api/auth/me`) and the login screen
- `AppHeader`: top navigation led by the NuVA wordmark and then the client logo, a sync/refresh button, the theme toggle, and a user menu with Account and Sign out
- `AppFooter`
- view switching through `ViewKey` state; there are no Next routes per view
- the date range shared by Overview and Call Logs

`/api/calls` is fetched after login and on refresh. All filtering and stats then run on the client in `src/lib/callStats.ts`.

**Route handlers (`src/app/api/*`)** all use `runtime = 'nodejs'`. Each starts with `requireSession()` or `requireAdmin()` from `src/lib/auth.ts`, which return a session or a `NextResponse` to return immediately. Reads need a session; mutations (departments POST, knowledge-base POST/DELETE) need the admin role. Retell failures come back as `{ error }` with status 502.

**Auth.** Supabase Auth with `@supabase/ssr` cookies (`src/lib/supabase/server.ts`). The role lives in the user's `app_metadata.role`, which only the Admin API can set (through `create-account`). The client checks `canEdit` only to hide controls; the server enforces the role separately.

**`src/lib/retell.ts`** is server-only:
- `retellFetch` applies a timeout and retries on 502/503/504. Pass `{ retry: false }` for calls that aren't idempotent, such as KB uploads.
- `getCallsDashboard` lists all calls for `AGENT_ID`, fetches full detail for each (8 at a time), flattens them into `FlatCallRow`, and builds the summaries. `cost_usd` is removed by `/api/calls` before reaching the client (`CallRow = Omit<FlatCallRow, 'cost_usd'>`).
- The department list is written to the agent LLM's single `transfer_call` tool as one `inferred` destination with a generated prompt (`syncDepartmentTransfers`). Call Routing starts from the client config's `departments` rather than reading the current setup back from Retell.
- After a KB upload, the code polls `get-knowledge-base`, because Retell's add response is stale.

**Demo mode** (`src/lib/demo.ts`). `isDemoMode()` requires both `NODE_ENV === 'development'` and `NUVA_DEMO=1`, so it can never turn on in a production build. Every route handler checks it before calling Supabase or Retell:
- auth uses a demo cookie session
- `/api/calls` runs generated `RetellRawCall` fixtures through `buildCallsDashboard` (the same pipeline as live data)
- the knowledge base is an in-memory store
- department sync is a no-op

When you add a route that touches Supabase or Retell, add a demo branch as well.

**Side effect.** Every `/api/calls` request also writes `exports/retell_calls_latest.xlsx` (`src/lib/excel.ts`, gitignored).

## UI conventions

- **Styling.** Plain CSS in `src/app/globals.css`, using design tokens on `:root` and overrides under `[data-theme='dark']`. Light is the default. The theme is stored in localStorage (`src/lib/theme.ts`) and applied before paint by an inline script in the layout; `useTheme` reads it with `useSyncExternalStore`.
- Use tokens (`--brand`, `--surface`, `--tone-*`, …), never raw colors. Config `Tone` keys map to `--tone-<key>`; use `toneVar()` from `components/ui.tsx`.
- **Components.**
  - Icons: `components/icons.tsx` (`<Icon name=…>`). Config files refer to icons by `IconName`.
  - Brand marks: `ClientLogo`, `NuaigLogo`, `NuvaMark` in `components/brand.tsx`. Light/dark logo variants are both rendered and swapped in CSS.
  - Page building blocks: `PageHeader`, `Card`, `ErrorState`, `InlineError` in `components/ui.tsx`.
  - Charts are hand-rolled SVG in `components/charts.tsx`.
