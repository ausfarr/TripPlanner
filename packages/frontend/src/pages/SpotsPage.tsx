import { FormEvent, useEffect, useState } from "react";
import { api } from "../api/client.js";
import type { IndoorOutdoor, Place, PlaceStatus, TransitMode } from "../types.js";

const STATUS_OPTIONS: PlaceStatus[] = ["want_to_try", "been", "favorite", "pass"];
const TRANSIT_OPTIONS: TransitMode[] = ["either", "train_friendly", "car_recommended"];
const INDOOR_OUTDOOR_OPTIONS: IndoorOutdoor[] = ["indoor", "outdoor", "both"];

const STATUS_LABEL: Record<PlaceStatus, string> = {
  want_to_try: "Want to try",
  been: "Been",
  favorite: "Favorite",
  pass: "Pass",
};

type FormState = {
  name: string;
  category: string;
  cuisine: string;
  vibe: string;
  indoor_outdoor: IndoorOutdoor | "";
  price_tier: string;
  neighborhood: string;
  transit_mode: TransitMode;
  address: string;
  notes: string;
  status: PlaceStatus;
};

const EMPTY_FORM: FormState = {
  name: "",
  category: "",
  cuisine: "",
  vibe: "",
  indoor_outdoor: "",
  price_tier: "",
  neighborhood: "",
  transit_mode: "either",
  address: "",
  notes: "",
  status: "want_to_try",
};

function toPlaceBody(form: FormState): Partial<Place> {
  return {
    name: form.name,
    category: form.category,
    cuisine: form.cuisine.split(",").map((s) => s.trim()).filter(Boolean),
    vibe: form.vibe.split(",").map((s) => s.trim()).filter(Boolean),
    indoor_outdoor: form.indoor_outdoor || null,
    price_tier: form.price_tier ? Number(form.price_tier) : null,
    neighborhood: form.neighborhood || null,
    transit_mode: form.transit_mode,
    address: form.address || null,
    notes: form.notes || null,
    status: form.status,
  };
}

export default function SpotsPage() {
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<PlaceStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importDefaultCategory, setImportDefaultCategory] = useState("");
  const [importResult, setImportResult] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (statusFilter !== "all") params.status = statusFilter;
      if (search.trim()) params.search = search.trim();
      setPlaces(await api.places.list(params));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      if (editingId) {
        await api.places.update(editingId, toPlaceBody(form));
      } else {
        await api.places.create(toPlaceBody(form));
      }
      setForm(EMPTY_FORM);
      setShowForm(false);
      setEditingId(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function startEdit(place: Place) {
    setEditingId(place.id);
    setForm({
      name: place.name,
      category: place.category,
      cuisine: place.cuisine.join(", "),
      vibe: place.vibe.join(", "),
      indoor_outdoor: place.indoor_outdoor ?? "",
      price_tier: place.price_tier ? String(place.price_tier) : "",
      neighborhood: place.neighborhood ?? "",
      transit_mode: place.transit_mode,
      address: place.address ?? "",
      notes: place.notes ?? "",
      status: place.status,
    });
    setShowForm(true);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this spot? This can't be undone.")) return;
    await api.places.remove(id);
    await load();
  }

  async function handleImport(e: FormEvent) {
    e.preventDefault();
    if (!importFile) return;
    setImportResult(null);
    try {
      const result = await api.places.importCsv(importFile, importDefaultCategory || undefined);
      setImportResult(
        `Imported ${result.imported} of ${result.total} (${result.skippedDuplicates} duplicates, ${result.skippedInvalid} invalid rows skipped).`,
      );
      await load();
    } catch (err) {
      setImportResult(`Import failed: ${(err as Error).message}`);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Spots</h2>
        <button
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
          onClick={() => {
            setEditingId(null);
            setForm(EMPTY_FORM);
            setShowForm((v) => !v);
          }}
        >
          {showForm ? "Cancel" : "Add spot"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4">
          <input
            required
            placeholder="Name"
            className="col-span-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            required
            placeholder="Category (restaurant, activity, event, ...)"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          />
          <select
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as PlaceStatus })}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <input
            placeholder="Cuisine tags, comma separated"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            value={form.cuisine}
            onChange={(e) => setForm({ ...form, cuisine: e.target.value })}
          />
          <input
            placeholder="Vibe tags, comma separated"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            value={form.vibe}
            onChange={(e) => setForm({ ...form, vibe: e.target.value })}
          />
          <select
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            value={form.indoor_outdoor}
            onChange={(e) => setForm({ ...form, indoor_outdoor: e.target.value as IndoorOutdoor | "" })}
          >
            <option value="">Indoor/outdoor unset</option>
            {INDOOR_OUTDOOR_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <select
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            value={form.price_tier}
            onChange={(e) => setForm({ ...form, price_tier: e.target.value })}
          >
            <option value="">Price unset</option>
            {[1, 2, 3, 4].map((p) => (
              <option key={p} value={p}>
                {"$".repeat(p)}
              </option>
            ))}
          </select>
          <input
            placeholder="Neighborhood"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            value={form.neighborhood}
            onChange={(e) => setForm({ ...form, neighborhood: e.target.value })}
          />
          <select
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            value={form.transit_mode}
            onChange={(e) => setForm({ ...form, transit_mode: e.target.value as TransitMode })}
          >
            {TRANSIT_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t.replace("_", " ")}
              </option>
            ))}
          </select>
          <input
            placeholder="Address"
            className="col-span-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
          <textarea
            placeholder="Notes"
            className="col-span-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
          <button type="submit" className="col-span-2 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">
            {editingId ? "Save changes" : "Create spot"}
          </button>
        </form>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">
          Import from Google Maps saved places (CSV or JSON)
        </h3>
        <form onSubmit={handleImport} className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept=".csv,.json"
            onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
          <input
            placeholder="Default category (optional)"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            value={importDefaultCategory}
            onChange={(e) => setImportDefaultCategory(e.target.value)}
          />
          <button
            type="submit"
            disabled={!importFile}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
          >
            Import
          </button>
        </form>
        {importResult && <p className="mt-2 text-sm text-slate-600">{importResult}</p>}
        <p className="mt-1 text-xs text-slate-400">
          Works with either format Google Takeout exports "Maps (your places)" lists in —
          CSV or GeoJSON. Imported rows default to "want to try" unless the file has a
          valid status column/field.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setStatusFilter("all")}
          className={`rounded-full px-3 py-1 text-xs font-medium ${statusFilter === "all" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}
        >
          All
        </button>
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${statusFilter === s ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
          className="ml-auto"
        >
          <input
            placeholder="Search name/neighborhood"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </form>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : places.length === 0 ? (
        <p className="text-sm text-slate-400">No spots yet.</p>
      ) : (
        <ul className="space-y-2">
          {places.map((place) => (
            <li key={place.id} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {place.name}{" "}
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                      {STATUS_LABEL[place.status]}
                    </span>{" "}
                    {place.source === "ai_suggested" && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                        AI-discovered
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500">
                    {place.category}
                    {place.neighborhood ? ` · ${place.neighborhood}` : ""}
                    {place.price_tier ? ` · ${"$".repeat(place.price_tier)}` : ""}
                    {` · ${place.transit_mode.replace("_", " ")}`}
                  </p>
                  {(place.cuisine.length > 0 || place.vibe.length > 0) && (
                    <p className="mt-1 text-xs text-slate-400">{[...place.cuisine, ...place.vibe].join(", ")}</p>
                  )}
                  {place.notes && <p className="mt-1 text-sm text-slate-600">{place.notes}</p>}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button onClick={() => startEdit(place)} className="text-xs text-slate-500 hover:text-slate-900">
                    Edit
                  </button>
                  <button onClick={() => handleDelete(place.id)} className="text-xs text-red-500 hover:text-red-700">
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
