import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { validator } from "hono/validator";
import {
  createHabitSchema,
  createSessionSchema,
  normalizeHabitName,
  replaceSessionSchema,
  resetSessionSchema,
  setCompletionSchema,
  updateHabitSchema,
  type BackupV1,
  type CreateHabitInput,
  type CreateSessionInput,
  type SessionSnapshot,
  type UpdateHabitInput
} from "../shared/contracts";

type Bindings = {
  ASSETS: Fetcher;
  CREATION_RATE_LIMIT: RateLimit;
  DB: D1Database;
  REQUEST_RATE_LIMIT: RateLimit;
  SESSION_RATE_LIMIT: RateLimit;
};

type SessionRow = {
  id: string;
  token_hash: string;
  created_at: number;
  expires_at: number;
  absolute_expires_at: number;
  initial_local_date: string | null;
  revision: number;
};

const INACTIVITY_MS = 24 * 60 * 60 * 1000;
const ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;
const CREATION_WINDOW_MS = 60 * 60 * 1000;
const SESSION_RENEWAL_INTERVAL_MS = 60 * 60 * 1000;
const SESSION_COOKIE = "__Host-demo_session";
const MAX_BACKUP_BYTES = 512 * 1024;
const securityHeaders = {
  "Content-Security-Policy":
    "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
};

const examples = [
  { id: "example-reading", name: "Leer 30 minutos", type: "bueno", label: "Este día sí leí 30 minutos" },
  { id: "example-exercise", name: "Hacer ejercicio", type: "bueno", label: "Este día sí hice ejercicio" },
  { id: "example-soda", name: "Tomar soda", type: "malo", label: "Este día no tomé soda" },
  { id: "example-alcohol", name: "Tomar alcohol", type: "malo", label: "Este día no tomé alcohol" },
  { id: "example-sleep", name: "Desvelarme", type: "malo", label: "Este día no me desvelé" }
] as const;

function normalizeName(name: string) {
  return normalizeHabitName(name);
}

function defaultLabel(name: string, type: "bueno" | "malo") {
  return type === "bueno" ? `Este día sí ${name}` : `Este día no ${name}`;
}

function isoDate(timestamp: number) {
  return new Date(timestamp).toISOString();
}

function shiftLocalDate(localDate: string, days: number) {
  const [year, month, day] = localDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function initialCompletions(localDate: string) {
  return [
    ["example-reading", 0],
    ["example-reading", -1],
    ["example-reading", -2],
    ["example-exercise", 0],
    ["example-exercise", -2],
    ["example-soda", 0],
    ["example-soda", -1],
    ["example-soda", -2],
    ["example-alcohol", 0],
    ["example-sleep", -1]
  ].map(([habitId, days]) => ({ habitId: String(habitId), date: shiftLocalDate(localDate, Number(days)) }));
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function setSessionCookie(context: Context, token: string, expiresAt: number) {
  setCookie(context, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))
  });
}

async function getSnapshot(db: D1Database, session: SessionRow): Promise<SessionSnapshot> {
  const [habits, completions] = await Promise.all([
    db
      .prepare("SELECT id, name, label, type, position FROM habits WHERE session_id = ? ORDER BY position")
      .bind(session.id)
      .all<SessionSnapshot["habits"][number]>(),
    db
      .prepare(
        "SELECT habit_id AS habitId, date FROM completions WHERE session_id = ? ORDER BY date, habit_id"
      )
      .bind(session.id)
      .all<SessionSnapshot["completions"][number]>()
  ]);

  return {
    revision: session.revision,
    session: { expiresAt: isoDate(session.expires_at) },
    habits: habits.results,
    completions: completions.results
  };
}

async function findLiveSession(db: D1Database, token: string, now: number) {
  const tokenHash = await hashToken(token);
  const session = await db
    .prepare(
      "SELECT id, token_hash, created_at, expires_at, absolute_expires_at, initial_local_date, revision FROM demo_sessions WHERE token_hash = ?"
    )
    .bind(tokenHash)
    .first<SessionRow>();

  if (!session) return null;
  if (session.expires_at <= now || session.absolute_expires_at <= now) {
    await db.prepare("DELETE FROM demo_sessions WHERE id = ?").bind(session.id).run();
    return null;
  }

  return session;
}

async function renewSession(db: D1Database, session: SessionRow, now: number) {
  if (session.expires_at - now > INACTIVITY_MS - SESSION_RENEWAL_INTERVAL_MS) return null;

  const expiresAt = Math.min(session.absolute_expires_at, now + INACTIVITY_MS);
  if (expiresAt <= session.expires_at) return null;
  const result = await db
    .prepare("UPDATE demo_sessions SET last_active_at = ?, expires_at = ? WHERE id = ? AND expires_at = ?")
    .bind(now, expiresAt, session.id, session.expires_at)
    .run();
  if (!result.meta.changes) return null;

  return { ...session, expires_at: expiresAt };
}

async function requireSession(context: Context, renew = true) {
  const token = getCookie(context, SESSION_COOKIE);
  if (!token) return context.json({ error: "SESSION_MISSING" }, 401);

  const now = Date.now();
  const session = await findLiveSession(context.env.DB as D1Database, token, now);
  if (!session) {
    deleteCookie(context, SESSION_COOKIE, { path: "/", secure: true });
    return context.json({ error: "SESSION_EXPIRED" }, 401);
  }

  if (!(await allowRequest(context.env.SESSION_RATE_LIMIT as RateLimit, session.id))) {
    context.header("Retry-After", "60");
    return context.json({ error: "SESSION_RATE_LIMITED" }, 429);
  }

  if (!renew) return session;

  const renewed = await renewSession(context.env.DB as D1Database, session, now);
  if (renewed) {
    setSessionCookie(context, token, renewed.expires_at);
    return renewed;
  }

  return session;
}

async function snapshotAfterMutation(db: D1Database, session: SessionRow) {
  await db.prepare("UPDATE demo_sessions SET revision = revision + 1 WHERE id = ?").bind(session.id).run();
  const current = await db
    .prepare("SELECT revision FROM demo_sessions WHERE id = ?")
    .bind(session.id)
    .first<{ revision: number }>();
  return getSnapshot(db, { ...session, revision: current!.revision });
}

function backupFromSnapshot(snapshot: SessionSnapshot): BackupV1 {
  const completions = Object.create(null) as Record<string, Record<string, true>>;
  for (const completion of snapshot.completions) {
    (completions[completion.habitId] ??= Object.create(null))[completion.date] = true;
  }

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    habits: snapshot.habits.map(({ id, name, label, type }) => ({ id, name, label, type })),
    completions
  };
}

function initialBackup(session: SessionRow): BackupV1 {
  const localDate = session.initial_local_date ?? new Date(session.created_at).toISOString().slice(0, 10);
  const completions: Record<string, Record<string, true>> = {};
  for (const completion of initialCompletions(localDate)) {
    (completions[completion.habitId] ??= {})[completion.date] = true;
  }

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    habits: examples.map(({ id, name, label, type }) => ({ id, name, label, type })),
    completions
  };
}

function replacementStatements(
  db: D1Database,
  session: SessionRow,
  revision: number,
  backup: BackupV1,
  now: number
) {
  const expiresAt = Math.min(session.absolute_expires_at, now + INACTIVITY_MS);
  const updatedRevision = revision + 1;
  // A negative revision is an in-transaction lock that cannot match a live session revision.
  const lockedRevision = -updatedRevision;
  const isLocked = "EXISTS (SELECT 1 FROM demo_sessions WHERE id = ? AND revision = ?)";
  const habits = backup.habits.map((habit, position) => ({
    ...habit,
    normalizedName: normalizeName(habit.name),
    position
  }));
  const completions = Object.entries(backup.completions).flatMap(([habitId, dates]) =>
    Object.keys(dates).map((date) => ({ habitId, date }))
  );
  const statements = [
    db
      .prepare(
        "UPDATE demo_sessions SET revision = ?, last_active_at = ?, expires_at = ? WHERE id = ? AND revision = ?"
      )
      .bind(lockedRevision, now, expiresAt, session.id, revision),
    db
      .prepare(`DELETE FROM habits WHERE session_id = ? AND ${isLocked}`)
      .bind(session.id, session.id, lockedRevision)
  ];

  statements.push(
    db
      .prepare(
        `INSERT INTO habits (session_id, id, name, normalized_name, type, label, position) SELECT ?, json_extract(value, '$.id'), json_extract(value, '$.name'), json_extract(value, '$.normalizedName'), json_extract(value, '$.type'), json_extract(value, '$.label'), json_extract(value, '$.position') FROM json_each(?) WHERE ${isLocked}`
      )
      .bind(session.id, JSON.stringify(habits), session.id, lockedRevision),
    db
      .prepare(
        `INSERT INTO completions (session_id, habit_id, date) SELECT ?, json_extract(value, '$.habitId'), json_extract(value, '$.date') FROM json_each(?) WHERE ${isLocked}`
      )
      .bind(session.id, JSON.stringify(completions), session.id, lockedRevision),
    db
      .prepare("UPDATE demo_sessions SET revision = ? WHERE id = ? AND revision = ?")
      .bind(updatedRevision, session.id, lockedRevision)
  );

  return { statements, expiresAt, updatedRevision };
}

async function exceedsBackupLimit(request: Request) {
  const contentLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(contentLength)) return contentLength > MAX_BACKUP_BYTES;

  const reader = request.clone().body?.getReader();
  if (!reader) return false;
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) return false;
    size += value.byteLength;
    if (size > MAX_BACKUP_BYTES) {
      await reader.cancel();
      return true;
    }
  }
}

async function replaceSession(
  db: D1Database,
  session: SessionRow,
  revision: number,
  backup: BackupV1,
  now: number
) {
  const replacement = replacementStatements(db, session, revision, backup, now);
  const results = await db.batch(replacement.statements);
  if (!results[0].meta.changes) return null;
  return getSnapshot(db, {
    ...session,
    revision: replacement.updatedRevision,
    expires_at: replacement.expiresAt
  });
}

async function appendMissingExamples(db: D1Database, sessionId: string) {
  const [existing, lastPosition] = await Promise.all([
    db
      .prepare("SELECT id, normalized_name FROM habits WHERE session_id = ?")
      .bind(sessionId)
      .all<{ id: string; normalized_name: string }>(),
    db
      .prepare("SELECT COALESCE(MAX(position), -1) AS position FROM habits WHERE session_id = ?")
      .bind(sessionId)
      .first<{ position: number }>()
  ]);
  const names = new Set(existing.results.map((habit) => habit.normalized_name));
  const ids = new Set(existing.results.map((habit) => habit.id));
  const missing = examples.filter((habit) => !names.has(normalizeName(habit.name)));
  if (!missing.length) return false;

  await db.batch(
    missing.map((habit, index) =>
      db
        .prepare(
          "INSERT INTO habits (session_id, id, name, normalized_name, type, label, position) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          sessionId,
          ids.has(habit.id) ? `${habit.id}-${crypto.randomUUID()}` : habit.id,
          habit.name,
          normalizeName(habit.name),
          habit.type,
          habit.label,
          (lastPosition?.position ?? -1) + index + 1
        )
    )
  );
  return true;
}

function clientKey(context: Context) {
  return `ip:${context.req.header("CF-Connecting-IP") ?? "unknown"}`;
}

async function cleanExpiredData(db: D1Database, now: number) {
  await db.batch([
    db.prepare("DELETE FROM demo_sessions WHERE expires_at <= ? OR absolute_expires_at <= ?").bind(now, now),
    db
      .prepare("DELETE FROM session_creation_limits WHERE window_started_at < ?")
      .bind(now - CREATION_WINDOW_MS),
    db.prepare("DELETE FROM daily_capacity WHERE day < date('now', '-2 days')")
  ]);
}

async function allowRequest(limiter: RateLimit, key: string) {
  try {
    return (await limiter.limit({ key })).success;
  } catch {
    return false;
  }
}

function isCapacityError(error: unknown) {
  return error instanceof Error && error.message.includes("CAPACITY_");
}

async function reserveSessionCreation(db: D1Database, key: string, now: number) {
  const windowStartedAt = now - (now % CREATION_WINDOW_MS);
  const reservation = await db
    .prepare(
      "INSERT INTO session_creation_limits (client_key, window_started_at, created_count) VALUES (?, ?, 1) ON CONFLICT(client_key, window_started_at) DO UPDATE SET created_count = created_count + 1 WHERE created_count < 5 RETURNING created_count"
    )
    .bind(key, windowStartedAt)
    .first<{ created_count: number }>();

  return reservation !== null;
}

async function createSession(db: D1Database, input: CreateSessionInput, now: number) {
  const token = createToken();
  const id = crypto.randomUUID();
  const absoluteExpiresAt = now + ABSOLUTE_MS;
  const expiresAt = Math.min(absoluteExpiresAt, now + INACTIVITY_MS);
  const tokenHash = await hashToken(token);
  const completionRows = initialCompletions(input.localDate);

  // A new session is also a cheap opportunity to reclaim abandoned expired data.
  await cleanExpiredData(db, now);

  await db.batch([
    db
      .prepare(
        "INSERT INTO demo_sessions (id, token_hash, created_at, last_active_at, expires_at, absolute_expires_at, initial_local_date) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(id, tokenHash, now, now, expiresAt, absoluteExpiresAt, input.localDate),
    ...examples.map((habit, position) =>
      db
        .prepare(
          "INSERT INTO habits (session_id, id, name, normalized_name, type, label, position) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(id, habit.id, habit.name, normalizeName(habit.name), habit.type, habit.label, position)
    ),
    ...completionRows.map((completion) =>
      db
        .prepare("INSERT INTO completions (session_id, habit_id, date) VALUES (?, ?, ?)")
        .bind(id, completion.habitId, completion.date)
    )
  ]);

  return {
    token,
    snapshot: await getSnapshot(db, {
      id,
      token_hash: tokenHash,
      created_at: now,
      expires_at: expiresAt,
      absolute_expires_at: absoluteExpiresAt,
      initial_local_date: input.localDate,
      revision: 0
    })
  };
}

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", async (context, next) => {
  for (const [name, value] of Object.entries(securityHeaders)) context.header(name, value);
  await next();
});

app.use("/api/*", async (context, next) => {
  context.header("Cache-Control", "no-store");
  await next();
});

app.use("/api/*", async (context, next) => {
  if (!(await allowRequest(context.env.REQUEST_RATE_LIMIT, clientKey(context)))) {
    context.header("Retry-After", "60");
    return context.json({ error: "REQUEST_RATE_LIMITED" }, 429);
  }

  return next();
});

app.use("/api/*", async (context, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(context.req.method)) return next();

  const origin = context.req.header("Origin");
  if (!origin || origin !== new URL(context.req.url).origin) {
    return context.json({ error: "INVALID_ORIGIN" }, 403);
  }

  if (!context.req.header("Content-Type")?.startsWith("application/json")) {
    return context.json({ error: "JSON_REQUIRED" }, 415);
  }

  return next();
});

app.onError((error, context) => {
  if (isCapacityError(error)) {
    context.header("Retry-After", "3600");
    return context.json({ error: "CAPACITY_EXHAUSTED" }, 503);
  }

  return context.json({ error: "SERVICE_UNAVAILABLE" }, 503);
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Exported as the Hono RPC contract.
const routes = app
  .get("/api/session", async (context) => {
    const session = await requireSession(context);
    if (session instanceof Response) return session;
    return context.json(await getSnapshot(context.env.DB, session), 200);
  })
  .post(
    "/api/session",
    validator("json", (value, context) => {
      const input = createSessionSchema.safeParse(value);
      if (!input.success) return context.json({ error: "INVALID_SESSION_INPUT" }, 400);
      return input.data;
    }),
    async (context) => {
      const now = Date.now();
      const token = getCookie(context, SESSION_COOKIE);
      if (token) {
        const session = await findLiveSession(context.env.DB, token, now);
        if (session) {
          if (!(await allowRequest(context.env.SESSION_RATE_LIMIT, session.id))) {
            context.header("Retry-After", "60");
            return context.json({ error: "SESSION_RATE_LIMITED" }, 429);
          }
          const renewed = await renewSession(context.env.DB, session, now);
          if (renewed) {
            setSessionCookie(context, token, renewed.expires_at);
            return context.json(await getSnapshot(context.env.DB, renewed), 200);
          }
          return context.json(await getSnapshot(context.env.DB, session), 200);
        }
      }

      if (!(await allowRequest(context.env.CREATION_RATE_LIMIT, clientKey(context)))) {
        context.header("Retry-After", "60");
        return context.json({ error: "SESSION_CREATION_RATE_LIMITED" }, 429);
      }

      if (!(await reserveSessionCreation(context.env.DB, clientKey(context), now))) {
        context.header("Retry-After", "3600");
        return context.json({ error: "SESSION_CREATION_RATE_LIMITED" }, 429);
      }

      const created = await createSession(context.env.DB, context.req.valid("json"), now);
      setSessionCookie(context, created.token, Date.parse(created.snapshot.session.expiresAt));
      return context.json(created.snapshot, 201);
    }
  )
  .get("/api/backup", async (context) => {
    const session = await requireSession(context);
    if (session instanceof Response) return session;
    return context.json(backupFromSnapshot(await getSnapshot(context.env.DB, session)));
  })
  .post(
    "/api/import",
    async (context, next) => {
      if (await exceedsBackupLimit(context.req.raw)) {
        return context.json({ error: "BACKUP_TOO_LARGE" }, 413);
      }
      return next();
    },
    validator("json", (value, context) => {
      const input = replaceSessionSchema.safeParse(value);
      if (!input.success) return context.json({ error: "INVALID_BACKUP" }, 400);
      return input.data;
    }),
    async (context) => {
      const session = await requireSession(context, false);
      if (session instanceof Response) return session;
      const input = context.req.valid("json");
      const snapshot = await replaceSession(
        context.env.DB,
        session,
        input.revision,
        input.backup,
        Date.now()
      );
      if (!snapshot) return context.json({ error: "REVISION_CONFLICT" }, 409);

      setSessionCookie(context, getCookie(context, SESSION_COOKIE)!, Date.parse(snapshot.session.expiresAt));
      return context.json(snapshot);
    }
  )
  .post(
    "/api/reset",
    validator("json", (value, context) => {
      const input = resetSessionSchema.safeParse(value);
      if (!input.success) return context.json({ error: "INVALID_RESET" }, 400);
      return input.data;
    }),
    async (context) => {
      const session = await requireSession(context, false);
      if (session instanceof Response) return session;
      const input = context.req.valid("json");
      const snapshot = await replaceSession(
        context.env.DB,
        session,
        input.revision,
        initialBackup(session),
        Date.now()
      );
      if (!snapshot) return context.json({ error: "REVISION_CONFLICT" }, 409);

      setSessionCookie(context, getCookie(context, SESSION_COOKIE)!, Date.parse(snapshot.session.expiresAt));
      return context.json(snapshot);
    }
  )
  .post(
    "/api/habits",
    validator("json", (value, context) => {
      const input = createHabitSchema.safeParse(value);
      if (!input.success) return context.json({ error: "INVALID_HABIT_INPUT" }, 400);
      return input.data;
    }),
    async (context) => {
      const session = await requireSession(context);
      if (session instanceof Response) return session;
      const input = context.req.valid("json") as CreateHabitInput;
      const position = await context.env.DB.prepare(
        "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM habits WHERE session_id = ?"
      )
        .bind(session.id)
        .first<{ position: number }>();

      try {
        await context.env.DB.prepare(
          "INSERT INTO habits (session_id, id, name, normalized_name, type, label, position) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
          .bind(
            session.id,
            input.id,
            input.name,
            normalizeName(input.name),
            input.type,
            input.label || defaultLabel(input.name, input.type),
            position?.position ?? 0
          )
          .run();
      } catch (error) {
        if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
          return context.json({ error: "DUPLICATE_HABIT" }, 409);
        }
        throw error;
      }

      return context.json(await snapshotAfterMutation(context.env.DB, session), 201);
    }
  )
  .post("/api/habits/examples", async (context) => {
    const session = await requireSession(context);
    if (session instanceof Response) return session;
    const changed = await appendMissingExamples(context.env.DB, session.id);
    return context.json(
      changed
        ? await snapshotAfterMutation(context.env.DB, session)
        : await getSnapshot(context.env.DB, session)
    );
  })
  .patch(
    "/api/habits/:habitId",
    validator("json", (value, context) => {
      const input = updateHabitSchema.safeParse(value);
      if (!input.success) return context.json({ error: "INVALID_HABIT_INPUT" }, 400);
      return input.data;
    }),
    async (context) => {
      const session = await requireSession(context);
      if (session instanceof Response) return session;
      const input = context.req.valid("json") as UpdateHabitInput;

      try {
        const result = await context.env.DB.prepare(
          "UPDATE habits SET name = ?, normalized_name = ?, type = ?, label = ? WHERE session_id = ? AND id = ?"
        )
          .bind(
            input.name,
            normalizeName(input.name),
            input.type,
            input.label || defaultLabel(input.name, input.type),
            session.id,
            context.req.param("habitId")
          )
          .run();
        if (!result.meta.changes) return context.json({ error: "HABIT_NOT_FOUND" }, 404);
      } catch (error) {
        if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
          return context.json({ error: "DUPLICATE_HABIT" }, 409);
        }
        throw error;
      }

      return context.json(await snapshotAfterMutation(context.env.DB, session));
    }
  )
  .delete("/api/habits/:habitId", async (context) => {
    const session = await requireSession(context);
    if (session instanceof Response) return session;
    const result = await context.env.DB.prepare("DELETE FROM habits WHERE session_id = ? AND id = ?")
      .bind(session.id, context.req.param("habitId"))
      .run();
    if (!result.meta.changes) return context.json({ error: "HABIT_NOT_FOUND" }, 404);
    return context.json(await snapshotAfterMutation(context.env.DB, session));
  })
  .put(
    "/api/habits/:habitId/completions/:date",
    validator("json", (value, context) => {
      const input = setCompletionSchema.safeParse(value);
      if (!input.success) return context.json({ error: "INVALID_COMPLETION_INPUT" }, 400);
      return input.data;
    }),
    async (context) => {
      const session = await requireSession(context);
      if (session instanceof Response) return session;
      const habitId = context.req.param("habitId");
      const date = context.req.param("date");
      const input = context.req.valid("json") as { completed: boolean; localDate: string };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return context.json({ error: "INVALID_COMPLETION_INPUT" }, 400);
      const validDate = createSessionSchema.shape.localDate.safeParse(date);
      if (!validDate.success) return context.json({ error: "INVALID_COMPLETION_INPUT" }, 400);
      if (date > input.localDate) return context.json({ error: "FUTURE_COMPLETION" }, 400);
      const habit = await context.env.DB.prepare("SELECT id FROM habits WHERE session_id = ? AND id = ?")
        .bind(session.id, habitId)
        .first();
      if (!habit) return context.json({ error: "HABIT_NOT_FOUND" }, 404);

      const result = input.completed
        ? await context.env.DB.prepare(
            "INSERT INTO completions (session_id, habit_id, date) VALUES (?, ?, ?) ON CONFLICT DO NOTHING"
          )
            .bind(session.id, habitId, date)
            .run()
        : await context.env.DB.prepare(
            "DELETE FROM completions WHERE session_id = ? AND habit_id = ? AND date = ?"
          )
            .bind(session.id, habitId, date)
            .run();
      return context.json(
        result.meta.changes
          ? await snapshotAfterMutation(context.env.DB, session)
          : await getSnapshot(context.env.DB, session)
      );
    }
  )
  .all("*", (context) => context.env.ASSETS.fetch(context.req.raw));

export type AppType = typeof routes;
export default {
  fetch: app.fetch,
  scheduled: (controller, env) => cleanExpiredData(env.DB, controller.scheduledTime)
} satisfies ExportedHandler<Bindings>;
