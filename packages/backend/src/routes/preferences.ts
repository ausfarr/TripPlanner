import { Router } from "express";
import { pool } from "../db/pool.js";
import type { Person, Sentiment } from "../types.js";

const router = Router();

const VALID_PERSON: Person[] = ["austin", "jess", "both"];
const VALID_SENTIMENT: Sentiment[] = ["like", "dislike"];

// GET /api/preferences?person=
router.get("/", async (req, res) => {
  const { person } = req.query;
  if (person && typeof person === "string") {
    const result = await pool.query(
      "SELECT * FROM preferences WHERE person = $1 ORDER BY created_at DESC",
      [person],
    );
    return res.json(result.rows);
  }
  const result = await pool.query("SELECT * FROM preferences ORDER BY created_at DESC");
  res.json(result.rows);
});

// POST /api/preferences — body: { person, sentiment, note }
router.post("/", async (req, res) => {
  const b = req.body ?? {};
  if (!VALID_PERSON.includes(b.person)) {
    return res.status(400).json({ error: `person must be one of ${VALID_PERSON.join(", ")}` });
  }
  if (!VALID_SENTIMENT.includes(b.sentiment)) {
    return res.status(400).json({ error: `sentiment must be one of ${VALID_SENTIMENT.join(", ")}` });
  }
  if (!b.note || typeof b.note !== "string" || !b.note.trim()) {
    return res.status(400).json({ error: "note is required" });
  }

  const result = await pool.query(
    "INSERT INTO preferences (person, sentiment, note) VALUES ($1,$2,$3) RETURNING *",
    [b.person, b.sentiment, b.note.trim()],
  );
  res.status(201).json(result.rows[0]);
});

router.delete("/:id", async (req, res) => {
  const result = await pool.query("DELETE FROM preferences WHERE id = $1 RETURNING id", [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: "Preference not found" });
  res.status(204).send();
});

export default router;
