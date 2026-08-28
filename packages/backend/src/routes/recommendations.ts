import { Router } from "express";
import { getRecommendations } from "../services/scoring.js";

const router = Router();

// GET /api/recommendations?limit=&category=&transit_mode=
router.get("/", async (req, res) => {
  const limit = Number(req.query.limit ?? 50);
  let recommendations = await getRecommendations(Number.isFinite(limit) ? limit : 50);

  if (req.query.category && typeof req.query.category === "string") {
    recommendations = recommendations.filter((p) => p.category === req.query.category);
  }
  if (req.query.transit_mode && typeof req.query.transit_mode === "string") {
    recommendations = recommendations.filter((p) => p.transit_mode === req.query.transit_mode);
  }

  res.json(recommendations);
});

export default router;
