CREATE TABLE daily_capacity (
  day TEXT PRIMARY KEY,
  sessions_created INTEGER NOT NULL DEFAULT 0 CHECK (sessions_created >= 0 AND sessions_created <= 100),
  completions_created INTEGER NOT NULL DEFAULT 0 CHECK (completions_created >= 0 AND completions_created <= 250000),
  rows_written INTEGER NOT NULL DEFAULT 0 CHECK (rows_written >= 0 AND rows_written <= 50000)
);

CREATE TABLE session_creation_limits (
  client_key TEXT NOT NULL,
  window_started_at INTEGER NOT NULL,
  created_count INTEGER NOT NULL CHECK (created_count >= 0 AND created_count <= 5),
  PRIMARY KEY (client_key, window_started_at)
);

CREATE INDEX session_creation_limits_expiry ON session_creation_limits(window_started_at);

CREATE TRIGGER enforce_session_capacity
BEFORE INSERT ON demo_sessions
BEGIN
  SELECT CASE WHEN (SELECT count(*) FROM demo_sessions) >= 100
    THEN RAISE(ABORT, 'GLOBAL_SESSION_CAPACITY_EXHAUSTED') END;
  SELECT CASE WHEN COALESCE((SELECT sessions_created FROM daily_capacity WHERE day = date('now')), 0) >= 100
    THEN RAISE(ABORT, 'SESSION_DAILY_CAPACITY_EXHAUSTED') END;
  SELECT CASE WHEN COALESCE((SELECT rows_written FROM daily_capacity WHERE day = date('now')), 0) >= 50000
    THEN RAISE(ABORT, 'DAILY_WRITE_CAPACITY_EXHAUSTED') END;
END;

CREATE TRIGGER account_session_write
AFTER INSERT ON demo_sessions
BEGIN
  INSERT INTO daily_capacity (day, sessions_created, rows_written)
  VALUES (date('now'), 1, 1)
  ON CONFLICT(day) DO UPDATE SET
    sessions_created = sessions_created + 1,
    rows_written = rows_written + 1;
END;

CREATE TRIGGER enforce_session_update_capacity
BEFORE UPDATE ON demo_sessions
BEGIN
  SELECT CASE WHEN COALESCE((SELECT rows_written FROM daily_capacity WHERE day = date('now')), 0) >= 50000
    THEN RAISE(ABORT, 'DAILY_WRITE_CAPACITY_EXHAUSTED') END;
END;

CREATE TRIGGER account_session_update
AFTER UPDATE ON demo_sessions
BEGIN
  INSERT INTO daily_capacity (day, rows_written)
  VALUES (date('now'), 1)
  ON CONFLICT(day) DO UPDATE SET rows_written = rows_written + 1;
END;

CREATE TRIGGER enforce_session_delete_capacity
BEFORE DELETE ON demo_sessions
BEGIN
  SELECT CASE WHEN COALESCE((SELECT rows_written FROM daily_capacity WHERE day = date('now')), 0) >= 50000
    THEN RAISE(ABORT, 'DAILY_WRITE_CAPACITY_EXHAUSTED') END;
END;

CREATE TRIGGER account_session_delete
AFTER DELETE ON demo_sessions
BEGIN
  INSERT INTO daily_capacity (day, rows_written)
  VALUES (date('now'), 1)
  ON CONFLICT(day) DO UPDATE SET rows_written = rows_written + 1;
END;

CREATE TRIGGER enforce_habit_write_capacity
BEFORE INSERT ON habits
BEGIN
  SELECT CASE WHEN length(NEW.name) < 1 OR length(NEW.name) > 80
    THEN RAISE(ABORT, 'INVALID_HABIT_NAME') END;
  SELECT CASE WHEN length(NEW.label) < 1 OR length(NEW.label) > 160
    THEN RAISE(ABORT, 'INVALID_HABIT_LABEL') END;
  SELECT CASE WHEN (SELECT count(*) FROM habits WHERE session_id = NEW.session_id) >= 25
    THEN RAISE(ABORT, 'SESSION_HABIT_CAPACITY_EXHAUSTED') END;
  SELECT CASE WHEN COALESCE((SELECT rows_written FROM daily_capacity WHERE day = date('now')), 0) >= 50000
    THEN RAISE(ABORT, 'DAILY_WRITE_CAPACITY_EXHAUSTED') END;
END;

CREATE TRIGGER account_habit_write
AFTER INSERT ON habits
BEGIN
  INSERT INTO daily_capacity (day, rows_written)
  VALUES (date('now'), 1)
  ON CONFLICT(day) DO UPDATE SET rows_written = rows_written + 1;
END;

CREATE TRIGGER enforce_habit_update_capacity
BEFORE UPDATE ON habits
BEGIN
  SELECT CASE WHEN COALESCE((SELECT rows_written FROM daily_capacity WHERE day = date('now')), 0) >= 50000
    THEN RAISE(ABORT, 'DAILY_WRITE_CAPACITY_EXHAUSTED') END;
END;

CREATE TRIGGER account_habit_update
AFTER UPDATE ON habits
BEGIN
  INSERT INTO daily_capacity (day, rows_written)
  VALUES (date('now'), 1)
  ON CONFLICT(day) DO UPDATE SET rows_written = rows_written + 1;
END;

CREATE TRIGGER enforce_habit_delete_capacity
BEFORE DELETE ON habits
BEGIN
  SELECT CASE WHEN COALESCE((SELECT rows_written FROM daily_capacity WHERE day = date('now')), 0) >= 50000
    THEN RAISE(ABORT, 'DAILY_WRITE_CAPACITY_EXHAUSTED') END;
END;

CREATE TRIGGER account_habit_delete
AFTER DELETE ON habits
BEGIN
  INSERT INTO daily_capacity (day, rows_written)
  VALUES (date('now'), 1)
  ON CONFLICT(day) DO UPDATE SET rows_written = rows_written + 1;
END;

CREATE TRIGGER enforce_completion_write_capacity
BEFORE INSERT ON completions
BEGIN
  SELECT CASE WHEN (SELECT count(*) FROM completions) >= 250000
    THEN RAISE(ABORT, 'GLOBAL_COMPLETION_CAPACITY_EXHAUSTED') END;
  SELECT CASE WHEN (SELECT count(*) FROM completions WHERE session_id = NEW.session_id) >= 20000
    THEN RAISE(ABORT, 'SESSION_COMPLETION_CAPACITY_EXHAUSTED') END;
  SELECT CASE WHEN COALESCE((SELECT completions_created FROM daily_capacity WHERE day = date('now')), 0) >= 250000
    THEN RAISE(ABORT, 'DAILY_COMPLETION_CAPACITY_EXHAUSTED') END;
  SELECT CASE WHEN COALESCE((SELECT rows_written FROM daily_capacity WHERE day = date('now')), 0) >= 50000
    THEN RAISE(ABORT, 'DAILY_WRITE_CAPACITY_EXHAUSTED') END;
END;

CREATE TRIGGER account_completion_write
AFTER INSERT ON completions
BEGIN
  INSERT INTO daily_capacity (day, completions_created, rows_written)
  VALUES (date('now'), 1, 1)
  ON CONFLICT(day) DO UPDATE SET
    completions_created = completions_created + 1,
    rows_written = rows_written + 1;
END;

CREATE TRIGGER enforce_completion_update_capacity
BEFORE UPDATE ON completions
BEGIN
  SELECT CASE WHEN COALESCE((SELECT rows_written FROM daily_capacity WHERE day = date('now')), 0) >= 50000
    THEN RAISE(ABORT, 'DAILY_WRITE_CAPACITY_EXHAUSTED') END;
END;

CREATE TRIGGER account_completion_update
AFTER UPDATE ON completions
BEGIN
  INSERT INTO daily_capacity (day, rows_written)
  VALUES (date('now'), 1)
  ON CONFLICT(day) DO UPDATE SET rows_written = rows_written + 1;
END;

CREATE TRIGGER enforce_completion_delete_capacity
BEFORE DELETE ON completions
BEGIN
  SELECT CASE WHEN COALESCE((SELECT rows_written FROM daily_capacity WHERE day = date('now')), 0) >= 50000
    THEN RAISE(ABORT, 'DAILY_WRITE_CAPACITY_EXHAUSTED') END;
END;

CREATE TRIGGER account_completion_delete
AFTER DELETE ON completions
BEGIN
  INSERT INTO daily_capacity (day, rows_written)
  VALUES (date('now'), 1)
  ON CONFLICT(day) DO UPDATE SET rows_written = rows_written + 1;
END;
