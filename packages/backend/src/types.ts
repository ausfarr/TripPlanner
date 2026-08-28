export type IndoorOutdoor = "indoor" | "outdoor" | "both";
export type TransitMode = "train_friendly" | "car_recommended" | "either";
export type PlaceStatus = "want_to_try" | "been" | "favorite" | "pass";
export type PlaceSource = "manual" | "csv_import";
export type OutingStatus = "planned" | "completed" | "cancelled";
export type Rating = "up" | "down";

export interface Place {
  id: string;
  name: string;
  category: string;
  cuisine: string[];
  vibe: string[];
  indoor_outdoor: IndoorOutdoor | null;
  price_tier: number | null;
  neighborhood: string | null;
  transit_mode: TransitMode;
  address: string | null;
  lat: number | null;
  lng: number | null;
  notes: string | null;
  status: PlaceStatus;
  source: PlaceSource;
  created_at: string;
  updated_at: string;
}

export interface Outing {
  id: string;
  outing_date: string;
  status: OutingStatus;
  wizard_input: Record<string, unknown> | null;
  weather_snapshot: Record<string, unknown> | null;
  itinerary_summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface OutingPlace {
  id: string;
  outing_id: string;
  place_id: string;
  sequence_order: number;
  time_slot: string | null;
  blurb: string | null;
  rating: Rating | null;
  rating_note: string | null;
  rated_at: string | null;
  created_at: string;
}

export interface WizardInput {
  scope: "single" | "weekend";
  days: string[]; // ISO dates, 1 or 2 entries
  budget: number | null; // max price_tier 1-4
  mood: string[]; // free tags to bias toward, e.g. ["cozy", "adventurous"]
  indoorOutdoor: IndoorOutdoor | "no_preference";
  transitPreference: TransitMode;
}
