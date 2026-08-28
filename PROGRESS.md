# Progress log

Built autonomously in one session (2026-08-28). This is the running log the task asked
for — decisions made along the way, what's done, what's left, and exactly what's needed
from you to go live.

## What's done

**Design.** `DESIGN.md` covers repo structure, the Postgres schema, API shape, the
recommendation-scoring formula, and the LLM itinerary flow, with the reasoning behind each
choice. Built from `weekendplannerscope.md`, which you'd already scoped thoroughly — the
open questions in there were already resolved, so I proceeded straight to building rather
than re-asking them.

**Repo scaffold.** npm workspaces monorepo (`packages/backend`, `packages/frontend`),
deployed as a single Railway service — Express serves both the API and the built frontend,
so there's one service and one Postgres add-on to manage, not two deployments.

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
slim runtime image), `railway.json`, `.env.example` with placeholders only.

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
  short of an actual Railway deploy.
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
  private as the Railway URL is unlisted.

## What's left — needs you

Everything code-shaped is done and pushed to `claude/weekend-planner-scaffold-ac5x23`.
What's left is the handful of steps only you can do:

1. **Create a Railway account/project** (if you don't have one) and connect this GitHub
   repo to it.
2. **Add a Postgres add-on** to the Railway project — it auto-injects `DATABASE_URL` into
   the service, no manual wiring needed.
3. **Get an Anthropic API key** (console.anthropic.com — separate from your Claude Code/
   Cowork subscription, per your instructions) and set it as `ANTHROPIC_API_KEY` in the
   Railway service's variables.
4. **Deploy** — push (or click deploy) and Railway builds from the root `Dockerfile`.
   Migrations run automatically on boot.
5. Once it's live: **add a handful of real spots** (or run the CSV import against your
   actual Google Maps export) so the recommendation feed and wizard have something to work
   with — both are currently empty-state until you seed data. Then take it for a real spin
   — generate one actual plan and see whether the swap flow and the LLM's output quality
   feel right; that's the one part I couldn't fully exercise here (see verification notes
   above), and your real preference data will shape the itinerary prompt in ways synthetic
   test data can't.

Nothing here is a design fork in the road — it's account/credential setup, which isn't
mine to do. Ping me once Railway's connected and I can help debug the first real deploy if
anything doesn't come up clean.
