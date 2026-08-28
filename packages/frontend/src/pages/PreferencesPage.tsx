import { FormEvent, useEffect, useState } from "react";
import { api } from "../api/client.js";
import type { Person, Preference, ScoredPlace, Sentiment } from "../types.js";

const PERSON_LABEL: Record<Person, string> = { austin: "Austin", jess: "Jess", both: "Both" };

function GeneralPreferences() {
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [person, setPerson] = useState<Person>("jess");
  const [sentiment, setSentiment] = useState<Sentiment>("like");
  const [note, setNote] = useState("");

  async function load() {
    try {
      setPreferences(await api.preferences.list());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    await api.preferences.create(person, sentiment, note.trim());
    setNote("");
    await load();
  }

  async function handleDelete(id: string) {
    await api.preferences.remove(id);
    await load();
  }

  const grouped = (["austin", "jess", "both"] as Person[])
    .map((p) => ({ person: p, items: preferences.filter((pref) => pref.person === p) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-700">General preferences</h3>
      <p className="mt-1 text-xs text-slate-400">
        Free-form things Austin and Jess like or dislike — not tied to a specific spot. Used when Claude composes an
        itinerary.
      </p>

      <form onSubmit={handleSubmit} className="mt-3 flex flex-wrap items-center gap-2">
        <select
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          value={person}
          onChange={(e) => setPerson(e.target.value as Person)}
        >
          <option value="jess">Jess</option>
          <option value="austin">Austin</option>
          <option value="both">Both</option>
        </select>
        <select
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          value={sentiment}
          onChange={(e) => setSentiment(e.target.value as Sentiment)}
        >
          <option value="like">Likes</option>
          <option value="dislike">Dislikes</option>
        </select>
        <input
          placeholder="e.g. spicy food, live music, crowds"
          className="min-w-[220px] flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button
          type="submit"
          disabled={!note.trim()}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
        >
          Add
        </button>
      </form>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {loading ? (
        <p className="mt-3 text-sm text-slate-400">Loading…</p>
      ) : grouped.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">Nothing recorded yet.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {grouped.map(({ person: p, items }) => (
            <div key={p}>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{PERSON_LABEL[p]}</p>
              <ul className="mt-1 space-y-1">
                {items.map((pref) => (
                  <li key={pref.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>
                      <span className={pref.sentiment === "like" ? "text-emerald-600" : "text-rose-600"}>
                        {pref.sentiment === "like" ? "👍" : "👎"}
                      </span>{" "}
                      {pref.note}
                    </span>
                    <button onClick={() => handleDelete(pref.id)} className="text-xs text-slate-400 hover:text-red-600">
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
    <div className="space-y-6">
      <GeneralPreferences />

      <div>
        <div>
          <h2 className="text-xl font-semibold">Recommendation feed</h2>
          <p className="text-sm text-slate-500">
            Untried and under-tried spots, ranked by how closely they match what you two have already loved.
          </p>
        </div>

        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        {loading ? (
          <p className="mt-3 text-sm text-slate-400">Loading…</p>
        ) : recommendations.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">
            No recommendations yet — add some spots first, and mark a few as favorites so the feed has something to
            weight toward.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
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
    </div>
  );
}
