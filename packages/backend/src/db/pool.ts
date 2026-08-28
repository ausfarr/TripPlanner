import pg from "pg";
import { env } from "../env.js";

// pg's default DATE parser returns a JS Date object, which is the wrong type for our
// outing_date column: it round-trips awkwardly through JSON (becomes a full timestamp)
// and, worse, gets fed as-is into code that expects a plain 'YYYY-MM-DD' string (Open-Meteo
// requests, candidate/date matching in services/candidates.ts). Keep it a string throughout.
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  ssl: env.databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false },
});
