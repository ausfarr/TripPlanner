import { pool } from "../db/pool.js";
import type { Place } from "../types.js";

export interface ScoredPlace extends Place {
  score: number;
  scoreBreakdown: { tagAffinity: number; novelty: number; staleness: number };
}

// Weights are hand-tuned constants, not learned — this is deterministic, no-ML-needed
// scoring per DESIGN.md section 4. Kept as named constants so they're easy to retune.
const TAG_AFFINITY_WEIGHT = 3;
const NOVELTY_BONUS_WANT_TO_TRY = 5;
const STALENESS_MAX = 10;
const STALENESS_DAYS_PER_POINT = 14;
const STALENESS_NEVER_VISITED = 8;

function buildTagFrequency(tagLists: string[][]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const tags of tagLists) {
    for (const tag of tags) {
      freq.set(tag, (freq.get(tag) ?? 0) + 1);
    }
  }
  return freq;
}

export async function getRecommendations(limit = 50): Promise<ScoredPlace[]> {
  const [favoritesResult, upRatedTagsResult, candidatesResult, lastVisitResult] = await Promise.all([
    pool.query<{ cuisine: string[]; vibe: string[] }>(
      "SELECT cuisine, vibe FROM places WHERE status = 'favorite'",
    ),
    pool.query<{ cuisine: string[]; vibe: string[] }>(
      `SELECT p.cuisine, p.vibe FROM outing_places op
       JOIN places p ON p.id = op.place_id
       WHERE op.rating = 'up'`,
    ),
    pool.query<Place>("SELECT * FROM places WHERE status IN ('want_to_try', 'been')"),
    pool.query<{ place_id: string; last_date: string }>(
      `SELECT op.place_id, MAX(o.outing_date) AS last_date
       FROM outing_places op
       JOIN outings o ON o.id = op.outing_id
       WHERE o.status = 'completed'
       GROUP BY op.place_id`,
    ),
  ]);

  const likedTagLists = [
    ...favoritesResult.rows.map((r) => [...(r.cuisine ?? []), ...(r.vibe ?? [])]),
    ...upRatedTagsResult.rows.map((r) => [...(r.cuisine ?? []), ...(r.vibe ?? [])]),
  ];
  const tagFrequency = buildTagFrequency(likedTagLists);
  const maxFrequency = Math.max(1, ...tagFrequency.values());

  const lastVisitByPlace = new Map(lastVisitResult.rows.map((r) => [r.place_id, r.last_date]));

  const scored: ScoredPlace[] = candidatesResult.rows.map((place) => {
    const candidateTags = [...(place.cuisine ?? []), ...(place.vibe ?? [])];
    const tagAffinityRaw = candidateTags.reduce(
      (sum, tag) => sum + (tagFrequency.get(tag) ?? 0) / maxFrequency,
      0,
    );
    const tagAffinity = tagAffinityRaw * TAG_AFFINITY_WEIGHT;

    const novelty = place.status === "want_to_try" ? NOVELTY_BONUS_WANT_TO_TRY : 0;

    let staleness: number;
    const lastVisit = lastVisitByPlace.get(place.id);
    if (!lastVisit) {
      staleness = STALENESS_NEVER_VISITED;
    } else {
      const daysSince = (Date.now() - new Date(lastVisit).getTime()) / (1000 * 60 * 60 * 24);
      staleness = Math.min(STALENESS_MAX, daysSince / STALENESS_DAYS_PER_POINT);
    }

    const score = Math.round((tagAffinity + novelty + staleness) * 100) / 100;
    return { ...place, score, scoreBreakdown: { tagAffinity, novelty, staleness } };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
