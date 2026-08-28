export type IndoorOutdoor = "indoor" | "outdoor" | "both";
export type TransitMode = "train_friendly" | "car_recommended" | "either";
export type PlaceStatus = "want_to_try" | "been" | "favorite" | "pass";
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
  source: "manual" | "csv_import";
  created_at: string;
  updated_at: string;
}

export interface ScoredPlace extends Place {
  score: number;
  scoreBreakdown: { tagAffinity: number; novelty: number; staleness: number };
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
  place_name: string;
  place_category: string;
  place_neighborhood: string | null;
  place_status: PlaceStatus;
}

export interface Outing {
  id: string;
  outing_date: string;
  status: OutingStatus;
  wizard_input: WizardInput | null;
  weather_snapshot: Record<string, unknown> | null;
  itinerary_summary: string | null;
  places: OutingPlace[];
}

export interface WizardInput {
  scope: "single" | "weekend";
  days: string[];
  budget: number | null;
  mood: string[];
  indoorOutdoor: IndoorOutdoor | "no_preference";
  transitPreference: TransitMode;
}
