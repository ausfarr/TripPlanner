import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import type { ScoredPlace } from "../types.js";

export default function PreferencesPage() {
  const [recommendations, setRecommendations] = useState<ScoredPlace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.recommendations
      .list()
      .then(setRecommendations)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Recommendation feed</h2>
        <p className="text-sm text-slate-500">
          Untried and under-tried spots, ranked by how closely they match what you two have already loved.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : recommendations.length === 0 ? (
        <p className="text-sm text-slate-400">
          No recommendations yet — add some spots first, and mark a few as favorites so the feed has something to
          weight toward.
        </p>
      ) : (
        <ul className="space-y-2">
          {recommendations.map((place) => (
            <li key={place.id} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{place.name}</p>
                  <p className="text-xs text-slate-500">
                    {place.category}
                    {place.neighborhood ? ` · ${place.neighborhood}` : ""}
                    {place.price_tier ? ` · ${"$".repeat(place.price_tier)}` : ""}
                  </p>
                  {(place.cuisine.length > 0 || place.vibe.length > 0) && (
                    <p className="mt-1 text-xs text-slate-400">{[...place.cuisine, ...place.vibe].join(", ")}</p>
                  )}
                </div>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                  score {place.score}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
