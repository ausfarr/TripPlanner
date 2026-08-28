import cors from "cors";
import express from "express";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./env.js";
import { runMigrations } from "./db/migrate.js";
import placesRouter from "./routes/places.js";
import outingsRouter from "./routes/outings.js";
import recommendationsRouter from "./routes/recommendations.js";
import wizardRouter from "./routes/wizard.js";
import itineraryRouter from "./routes/itinerary.js";
import weatherRouter from "./routes/weather.js";
import preferencesRouter from "./routes/preferences.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/places", placesRouter);
app.use("/api/outings", outingsRouter);
app.use("/api/recommendations", recommendationsRouter);
app.use("/api/wizard", wizardRouter);
app.use("/api/itinerary", itineraryRouter);
app.use("/api/weather", weatherRouter);
app.use("/api/preferences", preferencesRouter);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// Serve the built frontend in production. The Dockerfile copies the frontend's
// `dist/` output to packages/backend/public.
const staticDir = join(__dirname, "..", "public");
app.use(express.static(staticDir));
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(join(staticDir, "index.html"));
});

async function main() {
  await runMigrations();
  app.listen(env.port, () => {
    console.log(`Weekend Planner backend listening on port ${env.port}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
