-- Weekend Planner initial schema. See DESIGN.md section 2 for rationale.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE places (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  cuisine TEXT[] NOT NULL DEFAULT '{}',
  vibe TEXT[] NOT NULL DEFAULT '{}',
  indoor_outdoor TEXT CHECK (indoor_outdoor IN ('indoor', 'outdoor', 'both')),
  price_tier SMALLINT CHECK (price_tier BETWEEN 1 AND 4),
  neighborhood TEXT,
  transit_mode TEXT NOT NULL DEFAULT 'either'
    CHECK (transit_mode IN ('train_friendly', 'car_recommended', 'either')),
  address TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'want_to_try'
    CHECK (status IN ('want_to_try', 'been', 'favorite', 'pass')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'csv_import')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_places_cuisine_gin ON places USING GIN (cuisine);
CREATE INDEX idx_places_vibe_gin ON places USING GIN (vibe);
CREATE INDEX idx_places_status ON places (status);
CREATE INDEX idx_places_transit_mode ON places (transit_mode);
CREATE INDEX idx_places_neighborhood ON places (neighborhood);

CREATE TABLE outings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outing_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'completed', 'cancelled')),
  wizard_input JSONB,
  weather_snapshot JSONB,
  itinerary_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_outings_date ON outings (outing_date);

CREATE TABLE outing_places (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outing_id UUID NOT NULL REFERENCES outings (id) ON DELETE CASCADE,
  place_id UUID NOT NULL REFERENCES places (id) ON DELETE RESTRICT,
  sequence_order SMALLINT NOT NULL,
  time_slot TEXT,
  blurb TEXT,
  rating TEXT CHECK (rating IN ('up', 'down')),
  rating_note TEXT,
  rated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_outing_places_outing_id ON outing_places (outing_id);
CREATE INDEX idx_outing_places_place_id ON outing_places (place_id);
