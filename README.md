# NuVA Voice AI Console

NuVA is the AI voice concierge for senior living communities, built by [NuAIg](https://www.nuaig.ai/). This console is where community staff can see how the voice agent is doing, review calls, keep its knowledge base current, and manage call transfers to departments.

Each deployment is white-labeled for a single client. The first client is **Seabury**.

## Getting started

```bash
npm install
cp .env.example .env.local                 # fill in CLIENT_ID, the Retell values and AUTH_SECRET
npm run dev:demo                           # generated sample calls, no Retell needed
npm run dev                                # http://localhost:3000, against the live Retell agent
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run dev:demo` | Dev server with generated sample calls; no Retell needed |
| `npm run build` | Production build (also type-checks) |
| `npm run lint` | ESLint |

### Demo mode

`npm run dev:demo` sets `NUVA_DEMO=1`. With it set, the console serves generated sample calls, an in-memory knowledge base, and a no-op routing sync, so you can click through every page without Retell. It only takes effect under `next dev`: production builds ignore the flag.

### Sign-in (not finalized)

The login approach for production hasn't been chosen yet. Until then, `src/lib/auth.ts` is a single shared admin account: `admin@seaburylife.org` / `demo@seabury`, or `CONSOLE_LOGIN_EMAIL` / `CONSOLE_LOGIN_PASSWORD` if set. The session cookie is signed with `AUTH_SECRET`, which production builds require.

## Product vs. client

- **Product (same for every client):** NuVA/NuAIg branding lives in `src/config/product.ts` and `public/brand/`.
- **Client (one per community):** each client has a config in `src/clients/<id>.ts` and assets in `public/clients/<id>/`. The config holds:
  - logo, favicon, contact details and time zone (all days and times display in it)
  - the Retell tool → call category mapping
  - knowledge-base sections
  - the starting list of transfer departments

`CLIENT_ID` picks which client a deployment serves.

### Onboarding a new client

1. Put the logos in `public/clients/<id>/`: `logo.png` for light backgrounds and, ideally, `logo-dark.png` for dark mode. If there's no dark logo, dark mode shows the light logo on a white plate.
2. Copy `src/clients/seabury.ts` to `src/clients/<id>.ts` and fill it in. The `integrations.retell.toolCategories` names must exactly match the tools on that client's Retell agent.
3. Register the new config in `src/clients/index.ts`.
4. Deploy with `CLIENT_ID=<id>` and that client's `RETELL_API_KEY` and `AGENT_ID`.
