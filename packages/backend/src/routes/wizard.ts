import { Router } from "express";
import { getCandidatesForWizard } from "../services/candidates.js";
import type { WizardInput } from "../types.js";

const router = Router();

export function validateWizardInput(b: unknown): { input: WizardInput } | { error: string } {
  const body = (b ?? {}) as Partial<WizardInput>;
  if (!Array.isArray(body.days) || body.days.length === 0 || body.days.length > 2) {
    return { error: "days must be an array of 1-2 ISO dates (YYYY-MM-DD)" };
  }
  if (body.scope !== "single" && body.scope !== "weekend") {
    return { error: "scope must be 'single' or 'weekend'" };
  }
  const transitPreference = body.transitPreference ?? "either";
  if (!["train_friendly", "car_recommended", "either"].includes(transitPreference)) {
    return { error: "transitPreference must be train_friendly, car_recommended, or either" };
  }
  const indoorOutdoor = body.indoorOutdoor ?? "no_preference";
  if (!["indoor", "outdoor", "both", "no_preference"].includes(indoorOutdoor)) {
    return { error: "indoorOutdoor must be indoor, outdoor, both, or no_preference" };
  }

  return {
    input: {
      scope: body.scope,
      days: body.days,
      budget: body.budget ?? null,
      mood: Array.isArray(body.mood) ? body.mood : [],
      indoorOutdoor,
      transitPreference,
    },
  };
}

// POST /api/wizard/candidates — the cheap, deterministic step: given wizard answers,
// return filtered/ranked/weather-aware candidate places per day. No LLM call.
router.post("/candidates", async (req, res) => {
  const validated = validateWizardInput(req.body);
  if ("error" in validated) return res.status(400).json({ error: validated.error });

  const candidates = await getCandidatesForWizard(validated.input);
  res.json({ input: validated.input, days: candidates });
});

export default router;
