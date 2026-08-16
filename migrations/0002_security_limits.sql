CREATE TABLE IF NOT EXISTS daily_capacity (
  day TEXT PRIMARY KEY,
  sessions_created INTEGER NOT NULL DEFAULT 0 CHECK (sessions_created >= 0 AND sessions_created <= 100),
  completions_created INTEGER NOT NULL DEFAULT 0 CHECK (completions_created >= 0 AND completions_created <= 250000),
  rows_written INTEGER NOT NULL DEFAULT 0 CHECK (rows_written >= 0 AND rows_written <= 50000)
);

CREATE TABLE IF NOT EXISTS session_creation_limits (
  client_key TEXT NOT NULL,
  window_started_at INTEGER NOT NULL,
  created_count INTEGER NOT NULL CHECK (created_count >= 0 AND created_count <= 5),
  PRIMARY KEY (client_key, window_started_at)
);

CREATE INDEX IF NOT EXISTS session_creation_limits_expiry ON session_creation_limits(window_started_at);
