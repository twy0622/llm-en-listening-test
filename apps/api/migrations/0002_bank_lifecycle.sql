-- Curated-bank lifecycle: quarterly seasons, archival, and offline review data.
-- Existing papers remain valid: NULL season means an unclassified legacy paper,
-- and the default review status keeps older imports publishable.

ALTER TABLE tests ADD COLUMN season TEXT;
ALTER TABLE tests ADD COLUMN archived_at TEXT;
ALTER TABLE tests ADD COLUMN review_status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE tests ADD COLUMN review_score REAL;
ALTER TABLE tests ADD COLUMN review_notes TEXT;
ALTER TABLE tests ADD COLUMN reviewed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_tests_selection
  ON tests (status, archived_at, season, level);
