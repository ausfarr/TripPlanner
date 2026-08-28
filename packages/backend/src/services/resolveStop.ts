import type { Pool, PoolClient } from "pg";
import type { ComposedStop } from "./anthropic.js";

type Queryable = Pool | PoolClient;

// A ComposedStop is either an existing DB place (place_id set) or a web-search-discovered
// suggestion (name + source_url set, guaranteed by anthropic.ts's cleanStops()). This
// resolves either shape down to a real place_id, inserting a new `places` row — tagged
// source: 'ai_suggested' so it's visibly distinct from manually-added or CSV-imported
// spots — for the latter.
export async function resolveStopPlaceId(db: Queryable, stop: ComposedStop): Promise<string> {
  if (stop.place_id) return stop.place_id;
  if (!stop.name) {
    throw new Error("Composed stop has neither place_id nor name — cannot resolve to a place.");
  }

  const notesParts = [stop.notes, stop.source_url ? `Source: ${stop.source_url}` : null].filter(Boolean);
  const result = await db.query(
    `INSERT INTO places (name, category, address, notes, status, source)
     VALUES ($1,$2,$3,$4,'want_to_try','ai_suggested') RETURNING id`,
    [stop.name, stop.category || "uncategorized", stop.address || null, notesParts.join(" — ") || null],
  );
  return result.rows[0].id;
}
