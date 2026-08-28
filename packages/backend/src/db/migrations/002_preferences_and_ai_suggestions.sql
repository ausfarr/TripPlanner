-- Adds general preference notes (feature: "things Jess likes/dislikes", not tied to a
-- specific place) and allows the itinerary generator to persist AI-discovered places
-- (feature: web-search-augmented itinerary suggestions). See DESIGN.md for both.

CREATE TABLE preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person TEXT NOT NULL CHECK (person IN ('austin', 'jess', 'both')),
  sentiment TEXT NOT NULL CHECK (sentiment IN ('like', 'dislike')),
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_preferences_person ON preferences (person);

ALTER TABLE places DROP CONSTRAINT places_source_check;
ALTER TABLE places ADD CONSTRAINT places_source_check
  CHECK (source IN ('manual', 'csv_import', 'ai_suggested'));
