-- AllEars schema. Questions keep their answer key in D1; the browser only ever
-- receives the public question payload until an attempt is submitted.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS topics (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('monologue', 'dialogue')),
  domain      TEXT NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE,
  card_json   TEXT NOT NULL,
  level       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'retired')),
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_topics_kind_level
  ON topics (kind, level, status);

CREATE TABLE IF NOT EXISTS tests (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  level         TEXT NOT NULL,
  accent        TEXT NOT NULL,
  duration_sec  INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at    TEXT NOT NULL,
  published_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_tests_status_level
  ON tests (status, level);

CREATE TABLE IF NOT EXISTS passages (
  id                 TEXT PRIMARY KEY,
  test_id            TEXT NOT NULL REFERENCES tests (id) ON DELETE CASCADE,
  position           INTEGER NOT NULL,
  type               TEXT NOT NULL CHECK (type IN ('monologue', 'dialogue')),
  topic              TEXT NOT NULL,
  transcript         TEXT NOT NULL,
  audio_key          TEXT NOT NULL,
  audio_mime         TEXT NOT NULL,
  audio_duration_sec REAL NOT NULL,
  voice              TEXT,
  UNIQUE (test_id, position)
);

CREATE INDEX IF NOT EXISTS idx_passages_test ON passages (test_id);

CREATE TABLE IF NOT EXISTS questions (
  id           TEXT PRIMARY KEY,
  test_id      TEXT NOT NULL REFERENCES tests (id) ON DELETE CASCADE,
  passage_id   TEXT NOT NULL REFERENCES passages (id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('mcq', 'gapfill', 'subjective')),
  prompt       TEXT NOT NULL,
  choices_json TEXT,
  answer_json  TEXT NOT NULL,
  explanation  TEXT NOT NULL,
  skill        TEXT NOT NULL,
  points       REAL NOT NULL DEFAULT 1,
  UNIQUE (passage_id, position)
);

CREATE INDEX IF NOT EXISTS idx_questions_test ON questions (test_id);

CREATE TABLE IF NOT EXISTS attempts (
  id                TEXT PRIMARY KEY,
  test_id           TEXT NOT NULL REFERENCES tests (id),
  device_id         TEXT NOT NULL,
  started_at        TEXT NOT NULL,
  deadline_at       TEXT NOT NULL,
  submitted_at      TEXT,
  status            TEXT NOT NULL DEFAULT 'in_progress'
                    CHECK (status IN ('in_progress', 'submitted')),
  score             REAL,
  max_score         REAL,
  duration_used_sec INTEGER,
  created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attempts_device
  ON attempts (device_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_attempts_test
  ON attempts (test_id);

CREATE TABLE IF NOT EXISTS answers (
  id          TEXT PRIMARY KEY,
  attempt_id  TEXT NOT NULL REFERENCES attempts (id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions (id),
  response    TEXT,
  is_correct  INTEGER,
  awarded     REAL,
  feedback    TEXT,
  graded_by   TEXT NOT NULL DEFAULT 'exact',
  graded_at   TEXT,
  UNIQUE (attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_answers_attempt ON answers (attempt_id);

-- Cheap fixed-window limiter for expensive endpoints (D1 is our only shared
-- storage on the free plan; no Redis required).
CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);
