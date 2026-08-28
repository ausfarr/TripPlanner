import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import type { Outing } from "../types.js";
import { formatOutingDate } from "../format.js";

export default function OutingsPage() {
  const [outings, setOutings] = useState<Outing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    try {
      setOutings(await api.outings.list());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function markCompleted(outingId: string) {
    await api.outings.update(outingId, { status: "completed" });
    await load();
  }

  async function rate(outingId: string, outingPlaceId: string, rating: "up" | "down") {
    await api.outings.rate(outingId, outingPlaceId, rating, noteDrafts[outingPlaceId]);
    await load();
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Outings</h2>
        <p className="text-sm text-slate-500">History of planned and completed outings — rate stops after the fact.</p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : outings.length === 0 ? (
        <p className="text-sm text-slate-400">No outings yet — generate a plan from the Plan tab to get started.</p>
      ) : (
        <ul className="space-y-3">
          {outings.map((outing) => (
            <li key={outing.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <p className="font-medium">
                  {formatOutingDate(outing.outing_date)}{" "}
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{outing.status}</span>
                </p>
                {outing.status === "planned" && (
                  <button
                    onClick={() => markCompleted(outing.id)}
                    className="text-xs font-medium text-slate-500 hover:text-slate-900"
                  >
                    Mark completed
                  </button>
                )}
              </div>
              {outing.itinerary_summary && <p className="mt-1 text-sm text-slate-600">{outing.itinerary_summary}</p>}

              <ul className="mt-3 space-y-2">
                {outing.places.map((op) => (
                  <li key={op.id} className="rounded-md bg-slate-50 p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">
                          {op.time_slot ? `${op.time_slot}: ` : ""}
                          {op.place_name}
                        </p>
                        {op.blurb && <p className="text-xs text-slate-500">{op.blurb}</p>}
                      </div>
                      {op.rating ? (
                        <span className="shrink-0 text-xs font-medium text-slate-500">
                          {op.rating === "up" ? "👍" : "👎"} rated
                        </span>
                      ) : (
                        <div className="flex shrink-0 items-center gap-1">
                          <input
                            placeholder="note (optional)"
                            className="w-28 rounded border border-slate-300 px-1.5 py-0.5 text-xs"
                            value={noteDrafts[op.id] ?? ""}
                            onChange={(e) => setNoteDrafts({ ...noteDrafts, [op.id]: e.target.value })}
                          />
                          <button onClick={() => rate(outing.id, op.id, "up")} className="text-sm" title="Thumbs up">
                            👍
                          </button>
                          <button onClick={() => rate(outing.id, op.id, "down")} className="text-sm" title="Thumbs down">
                            👎
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
