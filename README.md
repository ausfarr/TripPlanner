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
- Deploy: Railway (single service, Dockerfile build)

## Local development

Only needed if you're iterating on the code somewhere Node/Postgres installs aren't
blocked — day-to-day use is via the deployed Railway URL, not a local run.

```bash
npm install                      # installs both workspaces
createdb weekend_planner         # or point DATABASE_URL at any Postgres instance
cp .env.example .env             # fill in DATABASE_URL; ANTHROPIC_API_KEY optional locally
                                  # (itinerary generation just errors cleanly without it)
npm run migrate                  # applies packages/backend/src/db/migrations
npm run dev:backend              # http://localhost:3000
npm run dev:frontend             # http://localhost:5173, proxies /api to :3000
```

## Deploy (Railway)

1. Create a Railway project, connect this GitHub repo.
2. Add a Postgres add-on to the project — Railway injects `DATABASE_URL` into the service
   automatically.
3. Set `ANTHROPIC_API_KEY` in the service's variables (see `.env.example` for the full
   list). This is a separate key from any Claude.ai/Claude Code subscription — create one
   at console.anthropic.com if needed.
4. Push to the branch Railway is watching. It builds from the root `Dockerfile` and runs
   migrations automatically on boot.
