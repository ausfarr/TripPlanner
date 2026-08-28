import { pool } from "../db/pool.js";

export async function fetchOutingWithPlaces(outingId: string) {
  const outingResult = await pool.query("SELECT * FROM outings WHERE id = $1", [outingId]);
  if (outingResult.rows.length === 0) return null;

  const placesResult = await pool.query(
    `SELECT op.*, p.name AS place_name, p.category AS place_category,
            p.neighborhood AS place_neighborhood, p.status AS place_status
     FROM outing_places op
     JOIN places p ON p.id = op.place_id
     WHERE op.outing_id = $1
     ORDER BY op.sequence_order ASC`,
    [outingId],
  );

  return { ...outingResult.rows[0], places: placesResult.rows };
}
