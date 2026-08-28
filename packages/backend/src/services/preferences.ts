import { pool } from "../db/pool.js";
import type { Preference } from "../types.js";

const PERSON_LABEL: Record<Preference["person"], string> = {
  austin: "Austin",
  jess: "Jess",
  both: "Both of them",
};

// Formats the general preferences memory (feature: free-text likes/dislikes, not tied to
// any specific place) into prompt text for the itinerary composer. Kept separate from
// scoring.ts's tag-based recommendation feed — this is freeform text, better suited to an
// LLM reasoning about fit than to deterministic matching.
export async function getPreferenceSummary(): Promise<string> {
  const result = await pool.query<Preference>("SELECT * FROM preferences ORDER BY created_at DESC");
  if (result.rows.length === 0) return "";

  const grouped = new Map<string, string[]>();
  for (const p of result.rows) {
    const key = `${PERSON_LABEL[p.person]} ${p.sentiment === "like" ? "likes" : "dislikes"}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(p.note);
  }

  return [...grouped.entries()].map(([key, notes]) => `${key}: ${notes.join("; ")}`).join("\n");
}
