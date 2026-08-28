import pg from "pg";
import { env } from "../env.js";

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  ssl: env.databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false },
});
