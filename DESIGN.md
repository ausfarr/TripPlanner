# Weekend Planner — Design

Status: living doc, written during initial scaffold (auto-mode build). Reflects decisions
actually made in code, not just proposed. See `weekendplannerscope.md` for the original
scoping conversation this is derived from, and `PROGRESS.md` for build status / what's left.

## 1. Repo structure

Single repo, npm workspaces monorepo, deployed as **one app-hosting service** (not two). The
Express server serves both the JSON API and the built frontend static assets — this keeps
deploy config to a single service + one external Postgres, avoids CORS entirely, and avoids
paying for/managing two deployed services for a single-user app. (Originally one Railway
service; now Render for the app + a separate Supabase project for Postgres — see section 7.)

```
/
  DESIGN.md
  PROGRESS.md
  README.md
  package.json              # root workspace manager, dev script runs both
  .gitignore
  .env.example
  Dockerfile                 # multi-stage: build frontend -> build backend -> run
  render.yaml
  packages/
    backend/
      package.json
      tsconfig.json
      src/
        index.ts             # express app entry, serves /api/* + static frontend
        env.ts                # env var loading/validation
        db/
          pool.ts             # pg Pool
          migrate.ts          # tiny migration runner (no external migration lib)
          migrations/
            001_init.sql
        routes/
          places.ts
          outings.ts
          recommendations.ts
          wizard.ts
          itinerary.ts
          importCsv.ts
        services/
          scoring.ts          # recommendation feed weighting
          weather.ts          # Open-Meteo client
          anthropic.ts        # Claude API client + prompt construction
          candidates.ts       # shared candidate filter/rank (wizard + itinerary)
        types.ts
    frontend/
      package.json
      vite.config.ts
      tailwind.config.js
      index.html
      src/
        main.tsx
        App.tsx                # nav shell, 4 views
        api/client.ts
        pages/
          PlanPage.tsx
          PreferencesPage.tsx
          SpotsPage.tsx
          OutingsPage.tsx
        components/
          ...
```

Why npm workspaces over two separate repos or a single flat app: keeps backend/frontend
dependency trees isolated (Vite's deps vs. Express's) while still being one `git clone`,
one app-hosting service, one deploy. `npm install` at the root installs both.

## 2. Data model (Postgres)

Four tables. Deliberately not over-normalized — tags are stored as `text[]` columns rather
than a separate tags/join-table system, since v1 is single-user and query patterns are
simple ("places where tags overlap X"). Postgres `text[]` + `&&` overlap operator + a GIN
index covers this cheaply. Can be normalized later if tag management outgrows it.

### `places`

The core spots database (feature 1).

| column | type | notes |
|---|---|---|
| id | uuid PK | `gen_random_uuid()` |
| name | text not null | |
| category | text not null | free text: restaurant / activity / event / bar / museum / park / etc. Not an enum — this list will grow and isn't worth a migration each time. |
| cuisine | text[] | mostly for restaurants, e.g. `{italian, ramen}` |
| vibe | text[] | free tags, e.g. `{cozy, date-night, casual}` |
| indoor_outdoor | text | check in `('indoor','outdoor','both')`, nullable |
| price_tier | smallint | check 1–4 (`$`–`$$$$`), nullable |
| neighborhood | text | free text, e.g. "Astoria", "Great Neck" |
| transit_mode | text | check in `('train_friendly','car_recommended','either')`, default `'either'` — this is the Jess-avoids-the-train input |
| address | text | nullable, for eventual map display |
| lat, lng | double precision | nullable — not required at entry time, useful later for real distance calc instead of neighborhood-string matching |
| notes | text | freeform |
| status | text | check in `('want_to_try','been','favorite','pass')`, default `'want_to_try'` |
| source | text | `'manual'` \| `'csv_import'`, default `'manual'` |
| created_at, updated_at | timestamptz | |

### `outings`

One row per planned/completed outing (a single day or a leg of a weekend plan). History
log (feature 4) is just "query this table."

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| outing_date | date not null | |
| status | text | check in `('planned','completed','cancelled')`, default `'planned'` |
| wizard_input | jsonb | snapshot of the wizard answers that produced this outing, nullable (null for manually-created outings) |
| weather_snapshot | jsonb | Open-Meteo response used at generation time, nullable |
| itinerary_summary | text | the LLM-composed natural-language narrative for the whole outing, nullable until generated |
| created_at, updated_at | timestamptz | |

### `outing_places`

Join table: which places belong to which outing, in what order/slot, and — after the
fact — how it was rated. This is where **post-outing rating** (feature 2) lives: rating is
per place-within-an-outing, not per place globally, since "we went back and it was
different this time" is a real scenario worth keeping distinct history for. `places.status`
(`favorite`/`pass`/`been`) is the current rollup; `outing_places` is the immutable log.

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| outing_id | uuid FK -> outings, on delete cascade | |
| place_id | uuid FK -> places, on delete restrict | don't silently orphan history if a place is deleted |
| sequence_order | smallint not null | position within the outing (1, 2, 3…) |
| time_slot | text | free text label, e.g. `"lunch"`, `"afternoon"`, `"dinner"` |
| blurb | text | the LLM's per-stop rationale/description, nullable |
| rating | text | check in `('up','down')`, nullable until rated |
| rating_note | text | nullable |
| rated_at | timestamptz | nullable |

Rating an outing-place also updates the parent `places.status` (in `routes/outings.ts`):
an `up` rating sets the place to `favorite`; a `down` rating sets it to `been` (a single bad
visit doesn't auto-blacklist a place — demoting to `pass` is a manual call via Spots CRUD,
not something one rating decides). Marking an outing `completed` also bumps any of its
still-`want_to_try`, still-unrated stops to `been`, so visitation is tracked even without an
explicit rating.

### Indexes

- `places`: GIN on `(cuisine || vibe)` isn't directly indexable as a computed expression
  cheaply, so two separate GIN indexes: `idx_places_cuisine_gin`, `idx_places_vibe_gin`, plus
  btree on `status`, `transit_mode`, `neighborhood`.
- `outing_places`: btree on `place_id` (for "when did we last do X"), `outing_id`.
- `outings`: btree on `outing_date`.

### Migration mechanism

No ORM, no `node-pg-migrate` dependency — just numbered `.sql` files in
`backend/src/db/migrations/` and a ~40-line runner (`db/migrate.ts`) that tracks applied
filenames in a `_migrations` table and runs new ones in order. Runs automatically on server
boot (idempotent, safe for deploy-on-push on Render or any similar host). This is a
single-developer, single-env project (dev + prod are effectively "local disabled, the
deployed host is the only real environment"); a migration framework would be overhead, not
safety.

## 3. API shape

All under `/api`. REST-ish, JSON in/out.

- `GET/POST /api/places`, `GET/PATCH/DELETE /api/places/:id` — Spots CRUD.
- `POST /api/places/import` — multipart file upload, seed import. Accepts either CSV or
  the GeoJSON that Google Takeout actually exports for Maps "Saved" lists (Takeout doesn't
  offer CSV for those — discovered when Austin went to use the importer; see PROGRESS.md).
  Format is detected by file extension with a content-sniff fallback.
- `GET /api/recommendations` — scored, ranked list (query params for category/filter).
- `GET/POST /api/outings`, `GET/PATCH /api/outings/:id` — history log CRUD.
- `POST /api/outings/:id/places/:outingPlaceId/rate` — post-outing thumbs up/down + note.
- `POST /api/wizard/candidates` — given wizard answers, returns filtered/ranked/weather-aware
  candidate places per slot (no LLM call — this is the cheap deterministic step).
- `POST /api/itinerary/generate` — given an outing + wizard answers, runs candidate ranking
  then the Claude call, persists the result onto `outings`/`outing_places`, returns it.
- `POST /api/itinerary/:outingId/swap/:outingPlaceId` — replace one slot. Deterministically
  picks the next best unused candidate from the original shortlist and asks Claude for a
  *single* short blurb for just that slot (cheap call, not a full regeneration) — satisfies
  "swap one piece without regenerating the whole plan."
- `GET /api/weather?date=&days=` — thin proxy over Open-Meteo, mostly for the frontend to
  show a forecast preview in the wizard before generating.

## 4. Recommendation feed scoring (feature 5, deterministic, no LLM)

Score per untried/under-tried place = weighted sum:

- **Tag affinity**: overlap between the place's `cuisine`/`vibe` tags and the tag frequency
  distribution across `favorite`-status places and `up`-rated `outing_places`. More overlap
  with things Jess/Austin already loved = higher score.
- **Novelty**: `want_to_try` places score a flat bonus over `been`-but-not-favorited places
  (surfacing untried ideas is the point of the feed); `pass` is excluded entirely.
- **Staleness bonus**: places with no `outing_places` history, or whose last outing was
  longest ago, are boosted slightly — this is the "under-tried" half of "untried/under-tried."

No ML, no external calls — pure SQL aggregation + in-process weighting, cheap enough to be
freely browsable (matches the constraint that this view must never cost API money).

## 5. Weather integration (feature 7a)

Open-Meteo `/v1/forecast`, no API key. Backend geocodes nothing dynamic — since candidate
places span a wide area (Manhattan to Long Island), weather is fetched once for a fixed NYC
reference point (Manhattan lat/lng) per planning date, used only to bias indoor/outdoor
weighting in candidate ranking, not for per-place hyperlocal forecasts (not worth the
complexity for a same-metro-area weekend plan).

## 6. LLM itinerary composition (feature 7b/7c)

Retrieval-then-compose, per the scope doc:

1. `services/candidates.ts` filters+ranks places from Postgres against wizard criteria
   (budget/mood/indoor-outdoor/transit/day) + weather bias + recency (exclude/deprioritize
   anything in `outing_places` within a configurable recent-repeat window).
2. That shortlist (name, category, tags, notes, price tier, past rating if any) is passed to
   `services/anthropic.ts`, which prompts Claude (model configurable via env,
   default `claude-sonnet-4-5`) to select, sequence, and write the itinerary. The prompt
   explicitly constrains Claude to choose only `place_id`s present in the shortlist, and the
   response is requested as structured JSON (`{stops: [{place_id, time_slot, blurb}],
   summary}`) so the backend can validate every `place_id` against the shortlist before
   persisting — any hallucinated id is rejected server-side rather than trusted.
3. Result is persisted as `outing_places` rows + `outings.itinerary_summary`.
4. Swap re-runs step 2's ranking (excluding the slot's current place) and asks for one new
   `{place_id, blurb}` from the remaining shortlist, not a full plan.

## 7. Deploy (Render + Supabase)

Originally targeted Railway (single service, Postgres add-on) — switched mid-build when
Austin's Railway trial expired and a genuinely free option was needed. The Dockerfile is
platform-agnostic (it was never Railway-specific), so the app itself needed zero rework;
only the deploy target and docs changed. See PROGRESS.md for the full account of this
pivot.

- **App hosting: Render**, free web service tier, built from the same root `Dockerfile`
  (multi-stage: install + `vite build` the frontend, install + `tsc` build the backend,
  final stage copies backend `dist/` + frontend `dist/` into a slim `node:22-slim` runtime
  image, backend serves frontend `dist/` as static files for any non-`/api` route). Costs
  $0/month; trades that for spinning down after ~15 min idle (cold start on next request)
  — acceptable for an app opened occasionally, not continuously.
- **Database: a dedicated Supabase Postgres project** ("weekend-planner", provisioned
  under Austin's own Supabase account, not shared with his other projects — consistent
  with "standalone, don't reuse other projects' infra"). Deliberately *not* Render's own
  bundled free Postgres, which expires after 90 days — the same reason Render's Postgres
  was already ruled out in the original scoping conversation; Supabase's free tier has no
  hard expiry (it auto-pauses after a week of total inactivity but resumes on the next
  connection, not a data-loss event). The schema (`001_init.sql`) was applied directly via
  Supabase's management API during provisioning; the app's own `_migrations` bookkeeping
  table was seeded to match, so its normal boot-time migration runner sees `001_init.sql`
  as already applied and doesn't attempt to re-run the (non-idempotent) `CREATE TABLE`
  statements against it.
  - Supabase provisions a public PostgREST API + anon key alongside the raw database by
    default, gated by Row-Level Security (RLS). This app never uses that layer — it
    connects with a direct `pg.Pool` over the Postgres connection string, which uses the
    `postgres` role and bypasses RLS regardless of whether it's enabled. RLS is currently
    *off* on all four tables, which is a real (if low-severity, given "data isn't
    sensitive") exposure via that unused REST layer; enabling it costs this app nothing
    since our own connection isn't subject to it. Left for Austin to decide — see
    PROGRESS.md for the exact SQL.
- Env vars (see `.env.example`): `DATABASE_URL` — **the Session Pooler connection string,
  not the direct one**. Supabase's direct connection is IPv6-only on the free tier, and
  Render (like several other hosts) has no outbound IPv6, which fails at boot with
  `ENETUNREACH` — hit this for real on the first deploy attempt, documented in PROGRESS.md.
  The Session pooler is IPv4 and is also the correct choice generally for a persistent
  server (as opposed to the Transaction pooler, meant for serverless). The DB password
  isn't retrievable via API, so getting the real value is a one-time dashboard visit,
  documented in README.md. Also `ANTHROPIC_API_KEY`, `PORT` (Render sets this
  automatically), `ANTHROPIC_MODEL` (optional override), `NODE_ENV`.
- No auth in v1 (data isn't sensitive, matches scope doc) — access control is just an
  unlisted Render URL. Noted as an easy later add (single shared-password middleware) if
  that ever changes, not architected against.

## 8. Deliberately out of scope / not blocked

Per the brief: no Jess login, no booking automation, no push notifications, no cross-repo
integration. None of the above design decisions assume single-user-forever — `places`,
`outings`, and auth are separate enough concerns that adding a second user later is a schema
addition (a `user_id` column + a real auth layer), not a rearchitecture.
