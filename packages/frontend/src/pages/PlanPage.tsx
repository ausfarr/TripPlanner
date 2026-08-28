import { FormEvent, useState } from "react";
import { api } from "../api/client.js";
import type { IndoorOutdoor, Outing, TransitMode, WizardInput } from "../types.js";
import { formatOutingDate } from "../format.js";

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function PlanPage() {
  const [scope, setScope] = useState<"single" | "weekend">("single");
  const [dayOne, setDayOne] = useState(todayPlus(2));
  const [dayTwo, setDayTwo] = useState(todayPlus(3));
  const [budget, setBudget] = useState("");
  const [mood, setMood] = useState("");
  const [indoorOutdoor, setIndoorOutdoor] = useState<IndoorOutdoor | "no_preference">("no_preference");
  const [transitPreference, setTransitPreference] = useState<TransitMode>("either");
  const [searchForEvents, setSearchForEvents] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [outings, setOutings] = useState<Outing[]>([]);
  const [swapping, setSwapping] = useState<string | null>(null);

  async function handleGenerate(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const input: WizardInput = {
        scope,
        days: scope === "single" ? [dayOne] : [dayOne, dayTwo],
        budget: budget ? Number(budget) : null,
        mood: mood
          .split(",")
          .map((m) => m.trim())
          .filter(Boolean),
        indoorOutdoor,
        transitPreference,
        searchForEvents,
      };
      const result = await api.itinerary.generate(input);
      setSummary(result.summary);
      setOutings(result.outings);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSwap(outingId: string, outingPlaceId: string) {
    setSwapping(outingPlaceId);
    try {
      const newOuting = await api.itinerary.swap(outingId, outingPlaceId);
      setOutings((prev) => prev.map((o) => (o.id === outingId ? newOuting : o)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSwapping(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Plan a weekend</h2>
        <p className="text-sm text-slate-500">
          Answer a few questions and Claude will compose a plan from your Spots database — nothing invented.
        </p>
      </div>

      <form onSubmit={handleGenerate} className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="col-span-2 flex gap-4">
          <label className="flex items-center gap-1.5 text-sm">
            <input type="radio" checked={scope === "single"} onChange={() => setScope("single")} />
            Single outing
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="radio" checked={scope === "weekend"} onChange={() => setScope("weekend")} />
            Full weekend (2 days)
          </label>
        </div>

        <label className="text-sm">
          {scope === "weekend" ? "Day 1" : "Date"}
          <input
            type="date"
            required
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            value={dayOne}
            onChange={(e) => setDayOne(e.target.value)}
          />
        </label>
        {scope === "weekend" && (
          <label className="text-sm">
            Day 2
            <input
              type="date"
              required
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              value={dayTwo}
              onChange={(e) => setDayTwo(e.target.value)}
            />
          </label>
        )}

        <label className="text-sm">
          Budget ceiling
          <select
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
          >
            <option value="">No limit</option>
            {[1, 2, 3, 4].map((p) => (
              <option key={p} value={p}>
                up to {"$".repeat(p)}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          Indoor / outdoor
          <select
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            value={indoorOutdoor}
            onChange={(e) => setIndoorOutdoor(e.target.value as IndoorOutdoor | "no_preference")}
          >
            <option value="no_preference">Let the weather decide</option>
            <option value="indoor">Indoor</option>
            <option value="outdoor">Outdoor</option>
            <option value="both">Mix of both</option>
          </select>
        </label>

        <label className="text-sm">
          Getting around
          <select
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            value={transitPreference}
            onChange={(e) => setTransitPreference(e.target.value as TransitMode)}
          >
            <option value="either">Either is fine</option>
            <option value="car_recommended">Prefer driving</option>
            <option value="train_friendly">Train is fine</option>
          </select>
        </label>

        <label className="text-sm">
          Mood / vibe (comma separated)
          <input
            placeholder="cozy, adventurous, low-key"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            value={mood}
            onChange={(e) => setMood(e.target.value)}
          />
        </label>

        <label className="col-span-2 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={searchForEvents}
            onChange={(e) => setSearchForEvents(e.target.checked)}
          />
          <span>
            Also search the web for what's happening this weekend (pop-ups, events, limited-run things) — adds a
            small cost per plan and can suggest something outside your Spots list, clearly marked and cited.
          </span>
        </label>

        <button
          type="submit"
          disabled={loading}
          className="col-span-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
        >
          {loading ? "Composing plan…" : "Generate itinerary"}
        </button>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {summary && (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-700">Overview</h3>
            <p className="mt-1 text-sm text-slate-600">{summary}</p>
          </div>

          {outings.map((outing) => (
            <div key={outing.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="font-medium">{formatOutingDate(outing.outing_date)}</p>
              <ul className="mt-2 space-y-2">
                {outing.places.map((op) => (
                  <li key={op.id} className="rounded-md bg-slate-50 p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">
                          {op.time_slot ? `${op.time_slot}: ` : ""}
                          {op.place_name}
                          {op.place_source === "ai_suggested" && (
                            <span className="ml-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                              new find
                            </span>
                          )}
                        </p>
                        {op.blurb && <p className="text-xs text-slate-500">{op.blurb}</p>}
                      </div>
                      <button
                        onClick={() => handleSwap(outing.id, op.id)}
                        disabled={swapping === op.id}
                        className="shrink-0 text-xs font-medium text-slate-500 hover:text-slate-900 disabled:opacity-40"
                      >
                        {swapping === op.id ? "Swapping…" : "Swap"}
                      </button>
                    </div>
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
