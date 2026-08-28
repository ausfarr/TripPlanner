# Weekend Planner — Scope Doc (v1)

**Owner:** Austin Farr
**Purpose of this doc:** align on scope before any code gets written. Nothing below is built yet.

---

## 1. Problem

Austin and Jess live in NYC and consistently struggle to decide what to do on weekends. Planning falls entirely on Austin by default — Jess doesn't initiate it. The friction isn't a lack of things to do in NYC, it's decision fatigue plus no shared memory of what's already been tried, liked, or disliked.

## 2. Success criteria

- Austin can generate a concrete weekend plan (what, where, when) in a couple minutes instead of starting from a blank page.
- The tool gets *better* over time because it remembers what Jess (and Austin) actually liked, not just a static list of NYC recommendations.
- Austin doesn't have to re-explain preferences every time — they're stored once and reused.
- Works from any browser (including his Gensler work laptop, which blocks local dev tool installs) — no local install required to *use* the app day-to-day.

## 3. Scope

### In scope (v1)
- **Places/things database** — CRUD for restaurants, activities, neighborhoods, events, etc. Each entry can carry tags (cuisine, vibe, indoor/outdoor, price tier, neighborhood), notes, and status (want to try / been / favorite / pass).
- **Preference capture, three ways:**
  1. **Manual entry** — Austin adds/edits places and notes directly.
  2. **Post-outing rating** — after a planned outing happens, a quick thumbs up/down + optional note, tied back to that place/activity.
  3. **Seed import** — one-time (or repeatable) import from an existing list, e.g. a Google Maps "saved places" export or a CSV, so the database doesn't start empty.
- **Weekend plan generation, hybrid approach:**
  1. **Guided wizard** — a handful of quick prompts each week (budget, mood, indoor/outdoor, how far you want to travel, Saturday/Sunday/both) that steer generation.
  2. **Auto-itinerary** — from wizard answers + stored preferences + history (avoid repeats, weight favorites), the app proposes a concrete plan: food + activity + rough timing for the day(s) selected. Austin can swap any individual piece for another suggestion. Supports both a full two-day plan and a single outing (e.g. just Saturday dinner) — same underlying generator, different scope selected in the wizard.
  3. **Recommendation feed** — independent of the wizard, a standing browsable list of ranked suggestions ("things you haven't tried that match what Jess likes") Austin can skim anytime, not just when actively planning.
- **History log** — every planned/completed outing recorded, so "we did that already" and "it's been months since we tried something new" are both answerable.
- **Weather-aware suggestions** — pull forecast for the planned day(s) and bias indoor vs. outdoor picks accordingly (free API, e.g. Open-Meteo — no key required).
- **Geographic/transit awareness** — places carry a location + a rough transit-mode tag (train-friendly vs. car-recommended). Since Austin and Jess have a car and range from Manhattan/Queens/Brooklyn/Flushing out to Great Neck/Little Neck and further on Long Island, but Jess prefers avoiding the train when possible, the wizard asks how they're getting around and generation weights accordingly rather than assuming subway-only NYC.
- **LLM-composed itineraries (Anthropic API)** — see section 5 below; the final "write and sequence the plan" step calls Claude directly rather than being purely rule-based.
- Single-user (Austin logs in/uses it; Jess sees the resulting plan, not the tool itself). No multi-user accounts in v1.

### Out of scope (v1 — explicitly deferred, not forgotten)
- Jess having her own login or editing data directly.
- Automated booking/reservations (OpenTable, Resy, etc.) — plan suggests, Austin still books manually.
- Push notifications / proactive "it's Friday, here's your plan" nudges (could be a v2 add-on, possibly via a scheduled Cowork task hitting the app's API rather than building notifications into the app itself).
- Budget/cost tracking integration with BudgetBuddy (interesting later idea, not now).
- Weather-aware re-ranking (nice-to-have; flagged as an open question below, not committed for v1).

## 4. Constraints

- **No local dev installs possible on the primary laptop** (Gensler work laptop blocks Node/Python/etc. installs). This rules out a "clone the repo and run it locally" workflow for both building *and* daily use.
- **Standalone repo**, deliberately separate from the Beelink homelab (BudgetBuddy, Immich, etc.) — not deployed there, not sharing infrastructure with it.
- Data isn't considered sensitive — no strong auth requirement, though a lightweight gate is cheap enough to include.
- Budget: effectively $0 preferred; small monthly cost (a few dollars) is acceptable if it removes real friction.

## 5. Proposed architecture

To match the "no local installs, ever" constraint, the whole lifecycle has to be browser/cloud-based — not just the finished app, but *building* it too.

**Stack** (consistent with your existing BudgetBuddy pattern, so anything you've already learned there transfers):
- Backend: Node/Express + TypeScript
- Database: Postgres
- Frontend: React + Vite + Tailwind

**Build environment:** Claude Code, run in a cloud sandbox rather than locally — either right inside a Cowork session (like the Personal OS project) or from GitHub Codespaces (browser-based, tied directly to the repo, no local install). Cowork is fine for the initial build-and-push; Codespaces is the better fit if you expect to keep iterating on this over weeks/months, since a Cowork sandbox is ephemeral between sessions and Codespaces persists and lives with the repo itself.

**Hosting/deployment recommendation: Railway.**
- One platform for both the web app and Postgres — connect the GitHub repo, it auto-deploys on push, no server to manage.
- Free usage credit covers a small personal app like this comfortably; if you ever exceed it, cost is on the order of a few dollars/month, not a subscription-tier expense.
- No local install needed at any point — you interact with it entirely through the Railway web dashboard and GitHub.
- Alternatives considered: Render (free tier Postgres has a 90-day expiry — not great for a "remembers everything forever" app), Vercel (excellent DX but its serverless model is a worse fit for an always-on Express/Postgres backend than for a frontend-heavy app).

**Access:** no auth for v1, given "data isn't sensitive" — just an unlisted URL. Easy to add a single shared password later (a few lines of middleware) if that changes.

**AI itinerary composition (Anthropic API):** you asked specifically whether the app should call the Claude API at runtime to generate plans, rather than pure hand-coded ranking logic. Recommendation: yes, but grounded — a retrieval-then-compose pattern, not a free-form "ask Claude for restaurant ideas" pattern:

1. The backend first filters/ranks candidate places from *your own database* (Postgres query: matches wizard criteria — mood, budget, indoor/outdoor, distance/transit mode, weather, not-recently-done).
2. That shortlist (plus relevant notes/ratings) gets passed to the Claude API, which selects, sequences, and writes the actual itinerary in natural language (e.g. reasoning about pairing a rainy-day museum with a nearby ramen spot Jess rated highly).
3. Claude is constrained to the shortlist you already curated — it can't invent a restaurant that doesn't exist in your data. This keeps the "smart, natural-sounding plan" benefit of an LLM without the hallucination risk of using it as a raw NYC recommendation engine.

This only applies to the higher-value "compose the plan" step — the always-on recommendation feed stays cheap deterministic ranking (no API call needed to just browse a list), since it needs to be freely browsable anytime without racking up API cost. Practically, this means: an Anthropic API key as an env var on Railway, billed separately from your Cowork/Claude.ai subscription — but given usage is roughly "once a week, one short generation call," the cost is negligible (well under $1/month), not a real budget line.

## 6. Rough plan / phases

1. **Scaffold** — repo structure, Postgres schema (places, tags, outings/history, ratings), basic Express API, React shell with the four views (Plan / Preferences / Spots / Outings, matching what was scoped earlier).
2. **Preference capture** — manual CRUD for places first (simplest, unblocks everything else); then post-outing rating flow; then a one-time import script for seed data (format TBD — see open questions).
3. **Recommendation feed** — simple ranking (unrated/untried places, weighted toward tags that match liked places) — no ML needed for v1.
4. **Wizard + auto-itinerary** — the guided Q&A, and the generation logic that turns wizard answers + preference data into a concrete Sat/Sun plan.
5. **Deploy** — Railway, connect repo, verify it's usable end-to-end from a phone browser and the work laptop.
6. **Live with it a few weeks**, then revisit the "out of scope" list (notifications, weather, etc.) based on what you actually miss.

## 7. Open questions — resolved

1. ~~Seed import format~~ → **Resolved.** Real seed data exists: a Google Maps saved places list, largely untried ideas rather than places already visited. Importer should default new imports to status "want to try," not "been."
2. ~~Geographic scope~~ → **Resolved.** Manhattan, Queens, Brooklyn, Flushing, and further out on Long Island (Great Neck/Little Neck and beyond) — they have a car and have driven as far as Rockaway Beach and an upstate NY mall trip. Jess prefers avoiding the train when possible, so the wizard needs a transit-mode input (train ok / prefer driving / either), not just a distance filter.
3. ~~"Weekend" granularity~~ → **Resolved.** Both — the generator supports a full two-day plan and a single outing, selected in the wizard.
4. ~~Weather~~ → **Resolved.** Yes, include it (Open-Meteo, no key required) to bias indoor/outdoor suggestions.
5. ~~Who kicks off the build~~ → **Resolved.** Austin will kick off the actual build session himself.

## 8. New decision this round: LLM-powered itinerary composition

Covered in section 5 above — the app calls the Claude API (your own key, env var) to compose the final itinerary from a pre-filtered shortlist, rather than relying purely on hand-coded ranking. Flagging as a real design decision (not a minor detail) because it changes the backend from "just a ranking function" to "a ranking function + a Claude API call with a carefully constrained prompt," and introduces a new secret (Anthropic API key) that needs to live in Railway's env vars, not in the repo.

---

*Once you've reviewed this and either answered the open questions or told me to make reasonable calls on them, the next step is a single kickoff prompt for a fresh Claude Code session to actually scaffold the repo — see accompanying message.*
