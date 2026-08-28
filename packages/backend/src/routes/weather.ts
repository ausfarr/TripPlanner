import { Router } from "express";
import { getForecast } from "../services/weather.js";

const router = Router();

// GET /api/weather?dates=2026-08-29,2026-08-30
router.get("/", async (req, res) => {
  const datesParam = req.query.dates;
  if (typeof datesParam !== "string" || datesParam.trim() === "") {
    return res.status(400).json({ error: "dates query param required, comma-separated YYYY-MM-DD" });
  }
  const dates = datesParam.split(",").map((d) => d.trim());
  try {
    const forecast = await getForecast(dates);
    res.json(forecast);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

export default router;
