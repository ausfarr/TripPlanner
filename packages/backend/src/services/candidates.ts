import { pool } from "../db/pool.js";
import type { Place, WizardInput } from "../types.js";
import { getForecast, type DayForecast } from "./weather.js";

export interface CandidatesForDay {
  date: string;
  forecast: DayForecast | null;
  candidates: (Place & { matchScore: number })[];
}

const DEFAULT_RECENT_REPEAT_DAYS = 21;
const CANDIDATES_PER_DAY = 25;

function transitCompatible(placeTransit: Place["transit_mode"], preference: WizardInput["transitPreference"]): boolean {
  if (preference === "either" || placeTransit === "either") return true;
  return placeTransit === preference;
}

function indoorOutdoorCompatible(
  placeValue: Place["indoor_outdoor"],
  preference: WizardInput["indoorOutdoor"],
  goodOutdoorWeather: boolean | null,
): boolean {
  const effectivePreference =
    preference === "no_preference" && goodOutdoorWeather !== null
      ? goodOutdoorWeather
        ? "outdoor"
        : "indoor"
      : preference;

  if (effectivePreference === "no_preference" || placeValue === null || placeValue === "both") return true;
  return placeValue === effectivePreference;
}

async function getRecentlyVisitedPlaceIds(withinDays: number): Promise<Set<string>> {
  const result = await pool.query<{ place_id: string }>(
    `SELECT DISTINCT op.place_id
     FROM outing_places op
     JOIN outings o ON o.id = op.outing_id
     WHERE o.status = 'completed'
       AND o.outing_date >= (CURRENT_DATE - $1::int)`,
    [withinDays],
  );
  return new Set(result.rows.map((r) => r.place_id));
}

// Deterministic filter + rank of candidate places for a wizard-driven plan. This is the
// "retrieval" half of the retrieval-then-compose pattern (DESIGN.md section 6) — no LLM
// call here, cheap and repeatable. One call covers all requested days; each day gets its
// own weather-biased ranking since indoor/outdoor fit can differ day to day.
export async function getCandidatesForWizard(
  input: WizardInput,
  excludePlaceIds: string[] = [],
): Promise<CandidatesForDay[]> {
  const [forecasts, recentlyVisited, allEligible] = await Promise.all([
    getForecast(input.days).catch(() => [] as DayForecast[]),
    getRecentlyVisitedPlaceIds(DEFAULT_RECENT_REPEAT_DAYS),
    pool.query<Place>("SELECT * FROM places WHERE status != 'pass'"),
  ]);

  const forecastByDate = new Map(forecasts.map((f) => [f.date, f]));
  const excludeSet = new Set(excludePlaceIds);

  const baseEligible = allEligible.rows.filter(
    (p) =>
      !excludeSet.has(p.id) &&
      !recentlyVisited.has(p.id) &&
      (input.budget == null || p.price_tier == null || p.price_tier <= input.budget) &&
      transitCompatible(p.transit_mode, input.transitPreference),
  );

  return input.days.map((date) => {
    const forecast = forecastByDate.get(date) ?? null;
    const goodOutdoorWeather = forecast ? forecast.isGoodOutdoorWeather : null;

    const scored = baseEligible
      .filter((p) => indoorOutdoorCompatible(p.indoor_outdoor, input.indoorOutdoor, goodOutdoorWeather))
      .map((place) => {
        const tags = [...(place.cuisine ?? []), ...(place.vibe ?? [])];
        const moodOverlap = tags.filter((t) => input.mood.includes(t)).length;
        const favoriteBoost = place.status === "favorite" ? 3 : 0;
        const noveltyBoost = place.status === "want_to_try" ? 1 : 0;
        const matchScore = moodOverlap * 4 + favoriteBoost + noveltyBoost;
        return { ...place, matchScore };
      })
      .sort((a, b) => b.matchScore - a.matchScore || Math.random() - 0.5)
      .slice(0, CANDIDATES_PER_DAY);

    return { date, forecast, candidates: scored };
  });
}
