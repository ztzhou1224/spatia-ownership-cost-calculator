-- What every visitor entered, one row per snapshot (owner direction 2026-11-19: "We record what every user put in combination").
-- No IP address, name, email or device field. A visit is tied together by the tab's random `session` id.
CREATE TABLE IF NOT EXISTS inputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session TEXT NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('load', 'edit', 'leave')),
  recorded_at TEXT NOT NULL,
  query TEXT NOT NULL,
  address TEXT,
  zip TEXT NOT NULL,
  st TEXT NOT NULL,
  county TEXT NOT NULL,
  values_json TEXT NOT NULL,
  changed_json TEXT NOT NULL,
  set_lines_json TEXT NOT NULL,
  lines_json TEXT NOT NULL,
  monthly REAL NOT NULL,
  yearly REAL NOT NULL,
  build TEXT NOT NULL,
  UNIQUE (session, seq)
);
CREATE INDEX IF NOT EXISTS inputs_at ON inputs (recorded_at);
CREATE INDEX IF NOT EXISTS inputs_place ON inputs (st, county, zip);
