import { Router } from "express";
import { pool } from "../db/pool.js";
import type { OutingStatus, Rating } from "../types.js";
import { fetchOutingWithPlaces } from "../services/outingQueries.js";

const router = Router();

const VALID_OUTING_STATUS: OutingStatus[] = ["planned", "completed", "cancelled"];
const VALID_RATING: Rating[] = ["up", "down"];

// GET /api/outings?status=&from=&to=
router.get("/", async (req, res) => {
  const { status, from, to } = req.query;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (status && typeof status === "string") {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  if (from && typeof from === "string") {
    params.push(from);
    conditions.push(`outing_date >= $${params.length}`);
  }
  if (to && typeof to === "string") {
    params.push(to);
    conditions.push(`outing_date <= $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(
    `SELECT * FROM outings ${where} ORDER BY outing_date DESC`,
    params,
  );

  const outings = await Promise.all(
    result.rows.map((outing) => fetchOutingWithPlaces(outing.id)),
  );
  res.json(outings);
});

router.get("/:id", async (req, res) => {
  const outing = await fetchOutingWithPlaces(req.params.id);
  if (!outing) return res.status(404).json({ error: "Outing not found" });
  res.json(outing);
});

// POST /api/outings — create an outing, optionally seeded with places.
// body: { outing_date, status?, wizard_input?, places?: [{place_id, sequence_order, time_slot, blurb}] }
router.post("/", async (req, res) => {
  const b = req.body ?? {};
  if (!b.outing_date || typeof b.outing_date !== "string") {
    return res.status(400).json({ error: "outing_date is required (YYYY-MM-DD)" });
  }
  if (b.status && !VALID_OUTING_STATUS.includes(b.status)) {
    return res.status(400).json({ error: `status must be one of ${VALID_OUTING_STATUS.join(", ")}` });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const outingResult = await client.query(
      `INSERT INTO outings (outing_date, status, wizard_input, weather_snapshot, itinerary_summary)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [
        b.outing_date,
        b.status ?? "planned",
        b.wizard_input ?? null,
        b.weather_snapshot ?? null,
        b.itinerary_summary ?? null,
      ],
    );
    const outing = outingResult.rows[0];

    if (Array.isArray(b.places)) {
      for (let i = 0; i < b.places.length; i++) {
        const p = b.places[i];
        if (!p.place_id) continue;
        await client.query(
          `INSERT INTO outing_places (outing_id, place_id, sequence_order, time_slot, blurb)
           VALUES ($1,$2,$3,$4,$5)`,
          [outing.id, p.place_id, p.sequence_order ?? i + 1, p.time_slot ?? null, p.blurb ?? null],
        );
      }
    }

    await client.query("COMMIT");
    res.status(201).json(await fetchOutingWithPlaces(outing.id));
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: (err as Error).message });
  } finally {
    client.release();
  }
});

router.patch("/:id", async (req, res) => {
  const b = req.body ?? {};
  const fields: string[] = [];
  const params: unknown[] = [];

  const setField = (column: string, value: unknown) => {
    params.push(value);
    fields.push(`${column} = $${params.length}`);
  };

  if (b.outing_date !== undefined) setField("outing_date", b.outing_date);
  if (b.status !== undefined) {
    if (!VALID_OUTING_STATUS.includes(b.status)) {
      return res.status(400).json({ error: `status must be one of ${VALID_OUTING_STATUS.join(", ")}` });
    }
    setField("status", b.status);
  }
  if (b.wizard_input !== undefined) setField("wizard_input", b.wizard_input);
  if (b.weather_snapshot !== undefined) setField("weather_snapshot", b.weather_snapshot);
  if (b.itinerary_summary !== undefined) setField("itinerary_summary", b.itinerary_summary);

  if (fields.length === 0) return res.status(400).json({ error: "No fields to update" });

  params.push(req.params.id);
  const result = await pool.query(
    `UPDATE outings SET ${fields.join(", ")}, updated_at = now() WHERE id = $${params.length} RETURNING id`,
    params,
  );
  if (result.rows.length === 0) return res.status(404).json({ error: "Outing not found" });

  // Marking an outing completed means any of its unrated stops were at least visited:
  // bump want_to_try -> been so history/staleness scoring picks it up even without a
  // rating. Explicit ratings (below) take precedence and can move it further to favorite.
  if (b.status === "completed") {
    await pool.query(
      `UPDATE places SET status = 'been', updated_at = now()
       WHERE status = 'want_to_try'
         AND id IN (
           SELECT place_id FROM outing_places WHERE outing_id = $1 AND rating IS NULL
         )`,
      [req.params.id],
    );
  }

  res.json(await fetchOutingWithPlaces(req.params.id));
});

// POST /api/outings/:id/places — add a stop to an outing
router.post("/:id/places", async (req, res) => {
  const b = req.body ?? {};
  if (!b.place_id) return res.status(400).json({ error: "place_id is required" });

  const outing = await pool.query("SELECT id FROM outings WHERE id = $1", [req.params.id]);
  if (outing.rows.length === 0) return res.status(404).json({ error: "Outing not found" });

  const seqResult = await pool.query(
    "SELECT COALESCE(MAX(sequence_order), 0) + 1 AS next FROM outing_places WHERE outing_id = $1",
    [req.params.id],
  );

  const result = await pool.query(
    `INSERT INTO outing_places (outing_id, place_id, sequence_order, time_slot, blurb)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [
      req.params.id,
      b.place_id,
      b.sequence_order ?? seqResult.rows[0].next,
      b.time_slot ?? null,
      b.blurb ?? null,
    ],
  );
  res.status(201).json(result.rows[0]);
});

router.delete("/:id/places/:outingPlaceId", async (req, res) => {
  const result = await pool.query(
    "DELETE FROM outing_places WHERE id = $1 AND outing_id = $2 RETURNING id",
    [req.params.outingPlaceId, req.params.id],
  );
  if (result.rows.length === 0) return res.status(404).json({ error: "Outing stop not found" });
  res.status(204).send();
});

// POST /api/outings/:id/places/:outingPlaceId/rate — post-outing thumbs up/down + note.
// up  -> place status becomes 'favorite' (unless it was manually set to 'pass' since being planned)
// down -> place status becomes 'been' (a bad visit doesn't auto-blacklist; that's a manual call)
router.post("/:id/places/:outingPlaceId/rate", async (req, res) => {
  const b = req.body ?? {};
  if (!VALID_RATING.includes(b.rating)) {
    return res.status(400).json({ error: `rating must be one of ${VALID_RATING.join(", ")}` });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const opResult = await client.query(
      `UPDATE outing_places
       SET rating = $1, rating_note = $2, rated_at = now()
       WHERE id = $3 AND outing_id = $4
       RETURNING *`,
      [b.rating, b.rating_note ?? null, req.params.outingPlaceId, req.params.id],
    );
    if (opResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Outing stop not found" });
    }

    const placeId = opResult.rows[0].place_id;
    const placeResult = await client.query("SELECT status FROM places WHERE id = $1", [placeId]);
    const currentStatus = placeResult.rows[0]?.status;

    if (b.rating === "up") {
      await client.query("UPDATE places SET status = 'favorite', updated_at = now() WHERE id = $1", [placeId]);
    } else if (b.rating === "down" && currentStatus !== "favorite") {
      await client.query("UPDATE places SET status = 'been', updated_at = now() WHERE id = $1", [placeId]);
    }

    await client.query("COMMIT");
    res.json(await fetchOutingWithPlaces(req.params.id));
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: (err as Error).message });
  } finally {
    client.release();
  }
});

export default router;
