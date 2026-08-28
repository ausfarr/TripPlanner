# Progress log

Built autonomously in one session (2026-08-28). This is the running log the task asked
for — decisions made along the way, what's done, what's left, and exactly what's needed
from you to go live.

## Update: CSV importer now also accepts Google Takeout's GeoJSON export

Google Takeout doesn't actually offer a CSV option for Maps "Saved" lists anymore (it may
have at some point, or CSV support may vary by list type — either way, what Austin got back
was GeoJSON: a FeatureCollection per list, each feature a saved place with a
`properties.location` object and a `[lng, lat]` point). Rather than sending him back to
fight Takeout's export options, extended `/api/places/import` to accept both formats,
detected by file extension with a content-sniff fallback for a renamed file.

The GeoJSON path is arguably better data than CSV would have been — it carries real lat/lng
coordinates, which the CSV path never had, so those imported places now support future
distance-based features without needing a separate geocoding step. Handles the case where a
saved pin has no resolved `location` object (a bare save without full place data) by
falling back to the place's Google Maps URL as the name rather than silently dropping the
row — not a great display name, but editable in Spots afterward, and better than losing
data. Frontend file picker now accepts `.csv,.json` and the copy explains both are
supported.

Verified against a real Postgres with a hand-built GeoJSON sample matching Takeout's actual
shape (including a location-less feature): all rows imported correctly with lat/lng and
notes preserved, re-import correctly caught all three as duplicates, and the existing CSV
path was re-tested as a regression check — still works. Both workspaces typecheck clean.

## Update: first Render deploy failed — ENETUNREACH connecting to Postgres

First real deploy attempt hit `Error: connect ENETUNREACH 2600:...` at boot, trying to
reach the database during the migration step. Root cause: Supabase's **direct** Postgres
connection (`db.<ref>.supabase.co`) is IPv6-only on the free tier, and Render's free tier
has no outbound IPv6 — the `2600:...` address in the error is that IPv6 host. This is a
known, documented incompatibility (Supabase's own docs list Render by name as an
IPv6-incompatible platform).

Fix: use Supabase's **Session Pooler** connection string instead of the direct one —
IPv4-compatible, and the right choice generally for a persistent server holding a
connection pool (as opposed to the Transaction pooler, meant for serverless/short-lived
connections). Verified the pooler hostname actually resolves to IPv4 addresses before
handing it over, rather than guessing:

```
postgres://postgres.vhipuawqafnpakjiopmk:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres
```

This was my mistake to correct, not a new decision to flag: my original README/`.env.example`
guidance told Austin to copy the direct connection string ("Connection pooling off"),
which is exactly what caused this. Fixed in README.md, `.env.example`, and DESIGN.md so the
guidance is right for anyone reading it going forward. No app code changed — this was
purely a wrong instruction, not a bug in `pool.ts` or the migration runner.

## Update: Railway trial expired → switched to Render + Supabase (both free)

You flagged that the Railway trial had expired and asked for a free option instead. What
changed:

- **Database:** provisioned a brand-new, dedicated Supabase Postgres project —
  **"weekend-planner"**, project ref `vhipuawqafnpakjiopmk`, in your existing Supabase
  account/org — via the Supabase MCP tools available in this session. Confirmed the cost
  first (`get_cost` returned $0/month, free tier) before creating anything, since that's a
  real resource on your actual account, not just a code change. Deliberately a new project,
  not your existing "World Builder" Supabase project — matches "standalone, don't reuse
  other projects' infra."
- Applied the full schema (`001_init.sql`) to it directly via Supabase's migration API, and
  seeded the app's own `_migrations` bookkeeping row to match, so the app's normal
  boot-time migration runner won't try to re-run that (non-idempotent) `CREATE TABLE` SQL
  against a database that already has it — verified via `list_tables` that all three data
  tables plus `_migrations` exist.
- **One security note surfaced by Supabase's own tooling, not auto-fixed:** every Supabase
  project also exposes a public REST API (PostgREST) gated by Row-Level Security, and RLS
  is currently *off* on all four tables. This app never uses that REST layer — it connects
  with a plain `pg.Pool` over the Postgres connection string (the `postgres` role, which
  bypasses RLS regardless) — so it doesn't affect how *this* app behaves. But it does mean
  anyone who obtained this project's anon key could read/write the tables directly through
  Supabase's REST API, bypassing the Express backend entirely. Given "data isn't
  sensitive" this is low-stakes, but enabling RLS costs this app nothing (again: our
  connection isn't subject to it), so it's a free hardening step if you want it. Run this
  in the Supabase SQL editor whenever you want it on — I didn't apply it myself, since
  turning on RLS with no policies is the kind of thing you should choose, not have decided
  for you:
  ```sql
  ALTER TABLE public.places ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.outings ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.outing_places ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public._migrations ENABLE ROW LEVEL SECURITY;
  ```
- **App hosting:** switched from Railway to **Render**'s free web-service tier. The
  Dockerfile was never Railway-specific, so no app code changed — only `railway.json` was
  removed and `render.yaml` added, plus DESIGN.md/README.md updated. Render's free tier
  spins the service down after ~15 min idle and cold-starts (~30–60s) on the next request —
  a real trade-off of "free," worth knowing going in, but fine for an app you open
  occasionally rather than one that needs to be always warm.
- I could not create the Render account or connect the GitHub repo myself — that's the one
  remaining step, same as it would've been on Railway. See "What's left" below for the
  exact steps, including where to get the real `DATABASE_URL` (the Supabase DB password
  isn't retrievable through the API I have, so that's a one-time dashboard visit).

## What's done

**Design.** `DESIGN.md` covers repo structure, the Postgres schema, API shape, the
recommendation-scoring formula, and the LLM itinerary flow, with the reasoning behind each
choice. Built from `weekendplannerscope.md`, which you'd already scoped thoroughly — the
open questions in there were already resolved, so I proceeded straight to building rather
than re-asking them.

**Repo scaffold.** npm workspaces monorepo (`packages/backend`, `packages/frontend`) —
Express serves both the API and the built frontend from one process, so there's one app
service to manage (now Render; see the update above) plus one external Postgres
(Supabase), not a pile of separate deployments.

**Backend (Express/TypeScript), all seven v1 features:**
- Spots CRUD (`/api/places`) with status/category/transit filters and search.
- Post-outing rating (`/api/outings/:id/places/:opId/rate`) — thumbs up/down + note,
  rolls up into the place's overall status (up → favorite, down → been unless already
  favorite; a single bad visit doesn't auto-blacklist a place).
- CSV seed import (`/api/places/import`) for your Google Maps saved-places export —
  defaults to "want to try," skips exact-name duplicates, tolerant of a few header-name
  variants (title/name, note/comment, etc.).
- Recommendation feed (`/api/recommendations`) — deterministic weighted scoring (tag
  affinity to your favorites + novelty + staleness), no LLM call, so it's free to browse.
- Wizard candidate filtering (`/api/wizard/candidates`) — budget/mood/indoor-outdoor/
  transit filtering against the Spots database, weather-aware.
- Weather integration (`/api/weather`) — Open-Meteo, no key required.
- LLM itinerary generation + swap (`/api/itinerary/generate`, `/api/itinerary/:id/swap/:opId`)
  — retrieval-then-compose: backend filters/ranks candidates, Claude selects/sequences/
  writes the plan via a forced tool-call (structured JSON), and every place_id it returns
  is validated server-side against the shortlist before being persisted — it cannot invent
  a place. Swap re-ranks and asks for one replacement stop, not a full regeneration.

**Frontend (React/Vite/Tailwind):** all four views — Plan (wizard + generated itinerary,
per-stop swap), Preferences (recommendation feed), Spots (CRUD + CSV import), Outings
(history + rating) — wired to the backend through a typed fetch client.

**Deploy config:** root `Dockerfile` (multi-stage: build frontend, build backend, ship a
slim runtime image), `render.yaml`, `.env.example` with placeholders only.

## Verification actually performed (not just "should work")

I don't get to hand-wave this given the instruction to actually test UI changes, so here's
what was checked, concretely, in this sandbox:
- Spun up a real local Postgres, ran migrations, and hit every route with `curl`: places
  CRUD, CSV import (confirmed "want to try" default and duplicate/category handling),
  recommendation scoring (confirmed tag-overlap math against manually seeded data), outing
  creation → mark-completed → rating (confirmed the status-rollup rule: a `down` rating did
  *not* demote an already-`favorite` place), and itinerary generation's error path.
- Started the Vite dev server and drove it with Playwright (screenshots taken of all four
  views); this caught a real bug — Postgres `DATE` columns come back from `pg` as JS `Date`
  objects, which was silently corrupting the swap route's date handling and showing raw
  ISO timestamps in the UI. Fixed at the root (`db/pool.ts` type parser override) and
  re-verified. See the "Fix outing_date type" commit.
- No Docker daemon is available in this sandbox, so I couldn't literally `docker build`
  the Dockerfile. Instead I ran each of its stages manually as real shell commands against
  a clean export of the committed tree (root `npm ci`, frontend build, backend build,
  production-only `npm ci --omit=dev --workspace packages/backend`, copying `dist`/
  `public`/`migrations` into the exact runtime layout) and booted the result against a real
  Postgres — confirmed migrations ran, static frontend served, and `/api/*` 404s correctly
  instead of falling through to the SPA route. This is the closest verification possible
  short of an actual Render deploy.
- Both workspaces typecheck clean (`tsc --noEmit`) and build clean.
- What I did *not* test: Open-Meteo and the Anthropic API calls themselves — this
  sandbox's network egress is allowlisted and blocks both hosts. Both fail *gracefully*
  where I could observe it (weather falls back to `forecast: null` without breaking
  candidate filtering; itinerary generation returns a clean 502 with a clear message when
  `ANTHROPIC_API_KEY` is unset) — but the actual API responses haven't been exercised.
  That's the first thing worth checking once it's deployed with a real key.

## Decisions made without stopping to ask

Flagging these since you weren't watching step by step:

- **Multer 1.x → 2.x, react-router-dom 6.x → 7.x**: the versions I'd have naturally reached
  for had open CVEs (multer 1.x has several patched-in-2.x vulnerabilities; react-router
  6.x-through-7.17 has an open-redirect advisory). Both are basic-API-compatible with what
  I wrote, so I used the patched versions instead. One remaining advisory: `esbuild`
  (via Vite) — moderate severity, dev-server-only exposure (it lets a malicious site read
  responses from Vite's local dev server). It doesn't affect the deployed app since Express
  serves the production build, not Vite, so I left it rather than force an unplanned Vite
  major-version jump. `npm audit` will keep surfacing it; safe to ignore for this project.
- **Rating rollup rule** (up → favorite; down → been-unless-already-favorite, not
  automatic `pass`): a single bad visit shouldn't permanently blacklist a place — demoting
  something to `pass` is left as a manual Spots edit. This is a real product judgment call,
  not just plumbing — worth you double-checking it matches how you'd actually want ratings
  to behave once you've used it a bit.
- **CSV import duplicate detection** is exact-name match (case-insensitive) — good enough
  for a one-time Google Maps import, but if you re-import a list with slightly different
  place names for the same spot, it won't catch it. Not worth building fuzzy matching for
  a personal one-time import; flagging in case you hit it.
- **Weather reference point**: one fixed Manhattan lat/lng for the whole day's forecast,
  not per-place — per DESIGN.md, not worth per-place hyperlocal forecasts for a same-metro
  weekend plan. Reasonable to revisit if a plan ever spans, say, Manhattan and Montauk on
  the same day with very different weather.
- **No auth in v1** — matches "data isn't sensitive," per the scope doc. The app is only as
  private as the Render URL is unlisted.

## What's left — needs you

Everything code-shaped is done and pushed to `claude/weekend-planner-scaffold-ac5x23`. The
database is already provisioned and has the schema on it. What's left is the handful of
steps only you can do:

1. **Get the real `DATABASE_URL`.** Go to
   [supabase.com/dashboard/project/vhipuawqafnpakjiopmk/settings/database](https://supabase.com/dashboard/project/vhipuawqafnpakjiopmk/settings/database)
   and copy the connection string (URI format, direct connection not the pooler — this app
   holds a long-lived connection pool, not one-shot serverless calls). You'll need to fill
   in or reset the DB password there; it isn't something I can retrieve through the API.
2. **Create a Render account** (if you don't have one) at render.com and connect this
   GitHub repo.
3. **New Web Service**, pick this repo, Free instance type — Render auto-detects the root
   `Dockerfile` (or use "New Blueprint Instance" against `render.yaml`).
4. **Get an Anthropic API key** (console.anthropic.com — separate from your Claude Code/
   Cowork subscription, per your instructions) and set both it and step 1's
   `DATABASE_URL` in the Render service's environment variables.
5. **Deploy.** Render builds from the `Dockerfile`; migrations run automatically on boot
   (a no-op on first boot since the schema's already there, but harmless).
6. Once it's live: **add a handful of real spots** (or run the CSV import against your
   actual Google Maps export) so the recommendation feed and wizard have something to work
   with — both are currently empty-state until you seed data. Then take it for a real spin
   — generate one actual plan and see whether the swap flow and the LLM's output quality
   feel right; that's the one part I couldn't fully exercise here (see verification notes
   above), and your real preference data will shape the itinerary prompt in ways synthetic
   test data can't.
7. Optional: decide whether to enable Row-Level Security on the Supabase tables — see the
   "Railway trial expired" update above for the exact SQL and why it's safe to turn on
   without breaking anything.

Nothing here is a design fork in the road — it's account/credential setup, which isn't
mine to do. Ping me once Render's connected and I can help debug the first real deploy if
anything doesn't come up clean.
