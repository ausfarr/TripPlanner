import { Router } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { pool } from "../db/pool.js";
import type { IndoorOutdoor, PlaceStatus, TransitMode } from "../types.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const VALID_STATUS: PlaceStatus[] = ["want_to_try", "been", "favorite", "pass"];
const VALID_TRANSIT: TransitMode[] = ["train_friendly", "car_recommended", "either"];
const VALID_INDOOR_OUTDOOR: IndoorOutdoor[] = ["indoor", "outdoor", "both"];

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

// GET /api/places?status=&category=&transit_mode=&search=
router.get("/", async (req, res) => {
  const { status, category, transit_mode, search } = req.query;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (status && typeof status === "string") {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  if (category && typeof category === "string") {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }
  if (transit_mode && typeof transit_mode === "string") {
    params.push(transit_mode);
    conditions.push(`transit_mode = $${params.length}`);
  }
  if (search && typeof search === "string") {
    params.push(`%${search.toLowerCase()}%`);
    conditions.push(`(LOWER(name) LIKE $${params.length} OR LOWER(neighborhood) LIKE $${params.length})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(
    `SELECT * FROM places ${where} ORDER BY created_at DESC`,
    params,
  );
  res.json(result.rows);
});

router.get("/:id", async (req, res) => {
  const result = await pool.query("SELECT * FROM places WHERE id = $1", [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: "Place not found" });
  res.json(result.rows[0]);
});

router.post("/", async (req, res) => {
  const b = req.body ?? {};
  if (!b.name || typeof b.name !== "string") {
    return res.status(400).json({ error: "name is required" });
  }
  if (!b.category || typeof b.category !== "string") {
    return res.status(400).json({ error: "category is required" });
  }
  if (b.status && !VALID_STATUS.includes(b.status)) {
    return res.status(400).json({ error: `status must be one of ${VALID_STATUS.join(", ")}` });
  }
  if (b.transit_mode && !VALID_TRANSIT.includes(b.transit_mode)) {
    return res.status(400).json({ error: `transit_mode must be one of ${VALID_TRANSIT.join(", ")}` });
  }
  if (b.indoor_outdoor && !VALID_INDOOR_OUTDOOR.includes(b.indoor_outdoor)) {
    return res.status(400).json({ error: `indoor_outdoor must be one of ${VALID_INDOOR_OUTDOOR.join(", ")}` });
  }
  if (b.price_tier != null && (b.price_tier < 1 || b.price_tier > 4)) {
    return res.status(400).json({ error: "price_tier must be between 1 and 4" });
  }

  const result = await pool.query(
    `INSERT INTO places
      (name, category, cuisine, vibe, indoor_outdoor, price_tier, neighborhood, transit_mode,
       address, lat, lng, notes, status, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      b.name,
      b.category,
      asStringArray(b.cuisine),
      asStringArray(b.vibe),
      b.indoor_outdoor ?? null,
      b.price_tier ?? null,
      b.neighborhood ?? null,
      b.transit_mode ?? "either",
      b.address ?? null,
      b.lat ?? null,
      b.lng ?? null,
      b.notes ?? null,
      b.status ?? "want_to_try",
      b.source ?? "manual",
    ],
  );
  res.status(201).json(result.rows[0]);
});

router.patch("/:id", async (req, res) => {
  const b = req.body ?? {};
  const fields: string[] = [];
  const params: unknown[] = [];

  const setField = (column: string, value: unknown) => {
    params.push(value);
    fields.push(`${column} = $${params.length}`);
  };

  if (b.name !== undefined) setField("name", b.name);
  if (b.category !== undefined) setField("category", b.category);
  if (b.cuisine !== undefined) setField("cuisine", asStringArray(b.cuisine));
  if (b.vibe !== undefined) setField("vibe", asStringArray(b.vibe));
  if (b.indoor_outdoor !== undefined) {
    if (b.indoor_outdoor !== null && !VALID_INDOOR_OUTDOOR.includes(b.indoor_outdoor)) {
      return res.status(400).json({ error: `indoor_outdoor must be one of ${VALID_INDOOR_OUTDOOR.join(", ")}` });
    }
    setField("indoor_outdoor", b.indoor_outdoor);
  }
  if (b.price_tier !== undefined) setField("price_tier", b.price_tier);
  if (b.neighborhood !== undefined) setField("neighborhood", b.neighborhood);
  if (b.transit_mode !== undefined) {
    if (!VALID_TRANSIT.includes(b.transit_mode)) {
      return res.status(400).json({ error: `transit_mode must be one of ${VALID_TRANSIT.join(", ")}` });
    }
    setField("transit_mode", b.transit_mode);
  }
  if (b.address !== undefined) setField("address", b.address);
  if (b.lat !== undefined) setField("lat", b.lat);
  if (b.lng !== undefined) setField("lng", b.lng);
  if (b.notes !== undefined) setField("notes", b.notes);
  if (b.status !== undefined) {
    if (!VALID_STATUS.includes(b.status)) {
      return res.status(400).json({ error: `status must be one of ${VALID_STATUS.join(", ")}` });
    }
    setField("status", b.status);
  }

  if (fields.length === 0) {
    return res.status(400).json({ error: "No fields to update" });
  }

  params.push(req.params.id);
  const result = await pool.query(
    `UPDATE places SET ${fields.join(", ")}, updated_at = now() WHERE id = $${params.length} RETURNING *`,
    params,
  );
  if (result.rows.length === 0) return res.status(404).json({ error: "Place not found" });
  res.json(result.rows[0]);
});

router.delete("/:id", async (req, res) => {
  const result = await pool.query("DELETE FROM places WHERE id = $1 RETURNING id", [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: "Place not found" });
  res.status(204).send();
});

interface NormalizedImportRow {
  name: string;
  category?: string;
  neighborhood?: string;
  address?: string;
  notes?: string;
  status?: string;
  lat?: number;
  lng?: number;
}

function normalizeCsvRows(buffer: Buffer): NormalizedImportRow[] {
  const records: Record<string, string>[] = parse(buffer, {
    columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
    skip_empty_lines: true,
    trim: true,
  });

  return records
    .map((row): NormalizedImportRow | null => {
      const name = row["title"] || row["name"] || row["place"];
      if (!name) return null;
      const noteParts = [row["note"], row["comment"], row["notes"], row["url"]].filter(Boolean);
      return {
        name,
        category: row["category"] || undefined,
        neighborhood: row["neighborhood"] || undefined,
        notes: noteParts.join(" — ") || undefined,
        status: row["status"] || undefined,
      };
    })
    .filter((r): r is NormalizedImportRow => r !== null);
}

// Google Takeout's Maps "Saved" export is GeoJSON, not CSV — one FeatureCollection per
// list, each feature a saved place with a properties.location object (name/address) and
// [lng, lat] point geometry. properties.location isn't always present (a bare saved pin
// without full place data), so fall back to properties itself for name/address.
function normalizeGoogleTakeoutGeoJson(buffer: Buffer): NormalizedImportRow[] {
  const data = JSON.parse(buffer.toString("utf8"));
  const features = Array.isArray(data?.features) ? data.features : Array.isArray(data) ? data : [];

  return features
    .map((feature: Record<string, unknown>) => {
      const props = (feature?.properties ?? {}) as Record<string, unknown>;
      const location = (props.location ?? props) as Record<string, unknown>;
      const name = (location.name as string) || (location.address as string) || (props.google_maps_url as string);
      if (!name) return null;

      const coords = (feature?.geometry as { coordinates?: unknown })?.coordinates;
      const [lng, lat] = Array.isArray(coords) ? coords : [undefined, undefined];

      return {
        name,
        address: (location.address as string) || undefined,
        notes: (props.comment as string) || undefined,
        lat: typeof lat === "number" ? lat : undefined,
        lng: typeof lng === "number" ? lng : undefined,
      };
    })
    .filter((r: NormalizedImportRow | null): r is NormalizedImportRow => r !== null);
}

// POST /api/places/import — seed import from a Google Maps saved-places export. Accepts
// either format Google Takeout hands out (CSV for some list types, GeoJSON for Maps
// "Saved" lists), detected by file extension with a content sniff fallback in case a file
// got renamed. Untried by default: imported places default to status "want_to_try" unless
// the source has a recognizable status column/field with a valid value.
router.post("/import", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded (field name: file)" });

  const filename = req.file.originalname.toLowerCase();
  const looksLikeJson = /^\s*[{[]/.test(req.file.buffer.toString("utf8", 0, 100));
  const isJson = filename.endsWith(".json") || (!filename.endsWith(".csv") && looksLikeJson);

  let rows: NormalizedImportRow[];
  try {
    rows = isJson ? normalizeGoogleTakeoutGeoJson(req.file.buffer) : normalizeCsvRows(req.file.buffer);
  } catch (err) {
    return res.status(400).json({ error: `Could not parse ${isJson ? "JSON" : "CSV"}: ${(err as Error).message}` });
  }

  const defaultCategory =
    typeof req.body?.default_category === "string" && req.body.default_category.trim()
      ? req.body.default_category.trim()
      : "uncategorized";

  const results = { imported: 0, skippedDuplicates: 0, skippedInvalid: 0, total: rows.length };

  for (const row of rows) {
    if (!row.name) {
      results.skippedInvalid++;
      continue;
    }

    const existing = await pool.query("SELECT id FROM places WHERE LOWER(name) = LOWER($1)", [row.name]);
    if (existing.rows.length > 0) {
      results.skippedDuplicates++;
      continue;
    }

    const category = row.category || defaultCategory;
    const statusRaw = (row.status || "").toLowerCase().replace(/\s+/g, "_");
    const status: PlaceStatus = VALID_STATUS.includes(statusRaw as PlaceStatus)
      ? (statusRaw as PlaceStatus)
      : "want_to_try";

    await pool.query(
      `INSERT INTO places (name, category, neighborhood, address, lat, lng, notes, status, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'csv_import')`,
      [
        row.name,
        category,
        row.neighborhood || null,
        row.address || null,
        row.lat ?? null,
        row.lng ?? null,
        row.notes || null,
        status,
      ],
    );
    results.imported++;
  }

  res.status(201).json(results);
});

export default router;
