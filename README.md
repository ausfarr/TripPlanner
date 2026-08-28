# Weekend Planner

A personal web app for planning NYC-area weekends — a database of spots (restaurants,
activities, events), a preference-weighted recommendation feed, and an LLM-composed
itinerary generator constrained to what's actually in the database. See `DESIGN.md` for
the full design/schema writeup and `PROGRESS.md` for current build status.

Built to be used entirely from a deployed URL — see "Deploy" below.

## Stack

- Backend: Node/Express + TypeScript (`packages/backend`)
- Frontend: React + Vite + Tailwind (`packages/frontend`)
- Database: Postgres
- Deploy: Render (single free web service, Dockerfile build) + Supabase (free Postgres)

## Local development

Only needed if you're iterating on the code somewhere Node/Postgres installs aren't
blocked — day-to-day use is via the deployed Render URL, not a local run.

```bash
npm install                      # installs both workspaces
createdb weekend_planner         # or point DATABASE_URL at any Postgres instance
cp .env.example .env             # fill in DATABASE_URL; ANTHROPIC_API_KEY optional locally
                                  # (itinerary generation just errors cleanly without it)
npm run migrate                  # applies packages/backend/src/db/migrations
npm run dev:backend              # http://localhost:3000
npm run dev:frontend             # http://localhost:5173, proxies /api to :3000
```

## Deploy (Render + Supabase, both free)

Originally targeted Railway; switched after the Railway trial expired. Render's free web
service tier + a dedicated Supabase Postgres project cost $0/month — see PROGRESS.md for
the full reasoning. The Supabase project is already provisioned with the schema applied;
Render still needs to be connected (that step needs your own account, same as Railway
would have).

1. **Get the real `DATABASE_URL` — use the Session Pooler, not the direct connection.**
   The Postgres project ("weekend-planner") already exists under your Supabase account. Go
   to [supabase.com/dashboard/project/vhipuawqafnpakjiopmk/settings/database](https://supabase.com/dashboard/project/vhipuawqafnpakjiopmk/settings/database)
   and copy the **Session pooler** connection string (URI format), not the direct one.
   This matters: Supabase's direct connection (`db.<ref>.supabase.co`) is IPv6-only on the
   free tier, and several hosts — Render included — don't support outbound IPv6, which
   fails with `ENETUNREACH` at boot. The Session pooler is IPv4 and is the right choice
   for a persistent server like this one anyway (vs. the Transaction pooler, meant for
   serverless/short-lived connections). It looks like:
   ```
   postgres://postgres.vhipuawqafnpakjiopmk:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres
   ```
   Fill in the real password (shown on that same settings page, or reset it there if you
   don't have it handy).
2. **Create a Render account** (if you don't have one) at render.com, connect this GitHub
   repo.
3. **New Web Service** → pick this repo → Render auto-detects the root `Dockerfile`
   (or use "New Blueprint Instance" pointed at `render.yaml` for one-click setup with env
   var names pre-filled). Choose the **Free** instance type.
4. Set the service's environment variables: `DATABASE_URL` (from step 1),
   `ANTHROPIC_API_KEY` (console.anthropic.com — separate from any Claude.ai/Claude Code
   subscription), and optionally `ANTHROPIC_MODEL` / `NODE_ENV=production` (see
   `.env.example`).
5. Deploy. Render builds from the `Dockerfile`; migrations run automatically on boot (the
   schema's already there from the initial provisioning, so this is a no-op on first boot,
   but harmless either way).

**Free-tier trade-off worth knowing:** Render's free web services spin down after ~15
minutes of no traffic and cold-start (~30–60s) on the next request. Fine for a
weekend-planning app you open occasionally; just don't expect an instant load if it's been
sitting idle.
