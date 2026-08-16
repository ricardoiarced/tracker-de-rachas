CREATE TABLE demo_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  absolute_expires_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX demo_sessions_expiry ON demo_sessions(expires_at);

CREATE TABLE habits (
  session_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('bueno', 'malo')),
  label TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (session_id, id),
  UNIQUE (session_id, normalized_name),
  UNIQUE (session_id, position),
  FOREIGN KEY (session_id) REFERENCES demo_sessions(id) ON DELETE CASCADE
);

CREATE TABLE completions (
  session_id TEXT NOT NULL,
  habit_id TEXT NOT NULL,
  date TEXT NOT NULL,
  PRIMARY KEY (session_id, habit_id, date),
  FOREIGN KEY (session_id, habit_id) REFERENCES habits(session_id, id) ON DELETE CASCADE
);

CREATE INDEX completions_by_session ON completions(session_id);
