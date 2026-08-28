import { Router } from "express";
import { pool } from "../db/pool.js";
import { getCandidatesForWizard } from "../services/candidates.js";
import { composeItinerary, composeSwap } from "../services/anthropic.js";
import { fetchOutingWithPlaces } from "../services/outingQueries.js";
import { getPreferenceSummary } from "../services/preferences.js";
import { resolveStopPlaceId } from "../services/resolveStop.js";
import { validateWizardInput } from "./wizard.js";
import type { WizardInput } from "../types.js";

const router = Router();

// POST /api/itinerary/generate — full retrieval-then-compose flow (DESIGN.md section 6).
// body: wizard answers. Creates one `outings` row per requested day, persists the LLM's
// stop selections as `outing_places`, and returns the created outings with places attached.
router.post("/generate", async (req, res) => {
  const validated = validateWizardInput(req.body);
  if ("error" in validated) return res.status(400).json({ error: validated.error });
  const input = validated.input;

  const candidateDays = await getCandidatesForWizard(input);
  const preferenceSummary = await getPreferenceSummary();

  let composed;
  try {
    composed = await composeItinerary(input, candidateDays, preferenceSummary);
  } catch (err) {
    return res.status(502).json({ error: `Itinerary generation failed: ${(err as Error).message}` });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const createdOutingIds: string[] = [];

    for (const day of composed.days) {
      const forecast = candidateDays.find((d) => d.date === day.date)?.forecast ?? null;
      const outingResult = await client.query(
        `INSERT INTO outings (outing_date, status, wizard_input, weather_snapshot, itinerary_summary)
         VALUES ($1, 'planned', $2, $3, $4) RETURNING id`,
        [day.date, JSON.stringify(input), forecast ? JSON.stringify(forecast) : null, composed.summary],
      );
      const outingId = outingResult.rows[0].id;
      createdOutingIds.push(outingId);

      for (let i = 0; i < day.stops.length; i++) {
        const stop = day.stops[i];
        const placeId = await resolveStopPlaceId(client, stop);
        await client.query(
          `INSERT INTO outing_places (outing_id, place_id, sequence_order, time_slot, blurb)
           VALUES ($1,$2,$3,$4,$5)`,
          [outingId, placeId, i + 1, stop.time_slot, stop.blurb],
        );
      }
    }

    await client.query("COMMIT");
    const outings = await Promise.all(createdOutingIds.map(fetchOutingWithPlaces));
    res.status(201).json({ summary: composed.summary, outings });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: (err as Error).message });
  } finally {
    client.release();
  }
});

// POST /api/itinerary/:outingId/swap/:outingPlaceId — replace one stop without
// regenerating the whole plan. Re-ranks candidates for that single day (excluding places
// already used elsewhere in the outing) and asks Claude for one replacement + blurb.
router.post("/:outingId/swap/:outingPlaceId", async (req, res) => {
  const outing = await fetchOutingWithPlaces(req.params.outingId);
  if (!outing) return res.status(404).json({ error: "Outing not found" });

  const targetStop = outing.places.find((p: { id: string }) => p.id === req.params.outingPlaceId);
  if (!targetStop) return res.status(404).json({ error: "Outing stop not found" });

  const wizardInput = outing.wizard_input as WizardInput | null;
  if (!wizardInput) {
    return res.status(400).json({ error: "This outing has no wizard_input on record; can't re-derive candidates for a swap." });
  }

  const singleDayInput: WizardInput = { ...wizardInput, days: [outing.outing_date] };
  const usedPlaceIds = outing.places.map((p: { place_id: string }) => p.place_id);
  const candidateDays = await getCandidatesForWizard(singleDayInput, usedPlaceIds);
  const candidates = candidateDays[0]?.candidates ?? [];

  if (candidates.length === 0) {
    return res.status(422).json({ error: "No remaining eligible candidates to swap in for this day." });
  }

  const restOfDaySummary = outing.places
    .filter((p: { id: string }) => p.id !== targetStop.id)
    .map((p: { time_slot: string; place_name: string }) => `${p.time_slot}: ${p.place_name}`)
    .join("; ");

  const preferenceSummary = await getPreferenceSummary();

  let swap;
  try {
    swap = await composeSwap(
      singleDayInput,
      outing.outing_date,
      targetStop.time_slot,
      candidates,
      restOfDaySummary,
      preferenceSummary,
    );
  } catch (err) {
    return res.status(502).json({ error: `Swap failed: ${(err as Error).message}` });
  }

  const newPlaceId = await resolveStopPlaceId(pool, swap);
  await pool.query(
    "UPDATE outing_places SET place_id = $1, blurb = $2, rating = NULL, rating_note = NULL, rated_at = NULL WHERE id = $3",
    [newPlaceId, swap.blurb, req.params.outingPlaceId],
  );

  res.json(await fetchOutingWithPlaces(req.params.outingId));
});

export default router;
