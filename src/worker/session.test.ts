import { createScheduledController, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import schema from "../../migrations/0001_initial.sql?raw";
import securitySchema from "../../migrations/0002_security_limits.sql?raw";
import initialDateSchema from "../../migrations/0003_session_initial_date.sql?raw";
import securityTriggers from "../../database/security-triggers.sql?raw";
import worker from "./index";

const origin = "https://demo.test";

function sessionRequest(init: RequestInit = {}) {
  return SELF.fetch(`${origin}/api/session`, {
    ...init,
    headers: { Origin: origin, ...init.headers }
  });
}

beforeAll(async () => {
  for (const statement of `${schema}\n${securitySchema}\n${initialDateSchema}\n${securityTriggers}`.split(
    /;\s*(?=CREATE|ALTER|DROP|$)/
  )) {
    if (statement.trim()) await env.DB.prepare(statement).run();
  }
});

beforeEach(async () => {
  await env.DB.exec("DELETE FROM demo_sessions");
  await env.DB.exec("DELETE FROM session_creation_limits; DELETE FROM daily_capacity");
});

describe("API de Sesión demo", () => {
  it("crea una Sesión demo aislada y expone su snapshot mediante la cookie", async () => {
    const created = await sessionRequest({
      method: "POST",
      headers: { "CF-Connecting-IP": "198.51.100.1", "Content-Type": "application/json" },
      body: JSON.stringify({ localDate: "2026-08-14" })
    });

    expect(created.status).toBe(201);
    const cookie = created.headers.get("Set-Cookie");
    expect(cookie).toContain("__Host-demo_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(created.headers.get("Cache-Control")).toBe("no-store");
    expect(created.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(created.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(created.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const spa = await SELF.fetch(`${origin}/`);
    expect(spa.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    const snapshot = await created.json<{ habits: unknown[]; completions: unknown[] }>();
    expect(snapshot.habits).toHaveLength(5);
    expect(snapshot.completions).toHaveLength(10);

    const resumed = await SELF.fetch(`${origin}/api/session`, {
      headers: { Cookie: cookie!.split(";")[0] }
    });
    expect(resumed.status).toBe(200);
    await expect(resumed.json()).resolves.toMatchObject({ revision: 0, habits: expect.any(Array) });

    const stored = await env.DB.prepare("SELECT token_hash FROM demo_sessions").first<{
      token_hash: string;
    }>();
    expect(stored?.token_hash).not.toContain(cookie!.split(";")[0].split("=")[1]);
  });

  it("rechaza una petición sin cookie de Sesión demo", async () => {
    const response = await SELF.fetch(`${origin}/api/session`);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "SESSION_MISSING" });
  });

  it("rechaza una fecha civil inexistente sin crear una Sesión demo", async () => {
    const response = await sessionRequest({
      method: "POST",
      headers: { "CF-Connecting-IP": "198.51.100.2", "Content-Type": "application/json" },
      body: JSON.stringify({ localDate: "2026-02-31" })
    });
    expect(response.status).toBe(400);
    await expect(
      env.DB.prepare("SELECT count(*) AS count FROM demo_sessions").first<{ count: number }>()
    ).resolves.toEqual({ count: 0 });
  });

  it("expira la Sesión demo por inactividad y por su límite absoluto", async () => {
    const created = await sessionRequest({
      method: "POST",
      headers: { "CF-Connecting-IP": "198.51.100.3", "Content-Type": "application/json" },
      body: JSON.stringify({ localDate: "2026-08-14" })
    });
    const cookie = created.headers.get("Set-Cookie")!.split(";")[0];

    await env.DB.prepare("UPDATE demo_sessions SET expires_at = ?")
      .bind(Date.now() - 1)
      .run();
    expect((await SELF.fetch("https://demo.test/api/session", { headers: { Cookie: cookie } })).status).toBe(
      401
    );

    const recreated = await sessionRequest({
      method: "POST",
      headers: { "CF-Connecting-IP": "198.51.100.3", "Content-Type": "application/json" },
      body: JSON.stringify({ localDate: "2026-08-14" })
    });
    const recreatedCookie = recreated.headers.get("Set-Cookie")!.split(";")[0];
    await env.DB.prepare("UPDATE demo_sessions SET expires_at = ?, absolute_expires_at = ?")
      .bind(Date.now() + 60_000, Date.now() - 1)
      .run();
    expect(
      (await SELF.fetch("https://demo.test/api/session", { headers: { Cookie: recreatedCookie } })).status
    ).toBe(401);
  });

  it("no renueva una Sesión demo en lecturas repetidas antes de la ventana de actividad", async () => {
    const created = await sessionRequest({
      method: "POST",
      headers: { "CF-Connecting-IP": "198.51.100.12", "Content-Type": "application/json" },
      body: JSON.stringify({ localDate: "2026-08-14" })
    });
    const cookie = created.headers.get("Set-Cookie")!.split(";")[0];
    const initial = await env.DB.prepare("SELECT last_active_at, expires_at FROM demo_sessions").first<{
      last_active_at: number;
      expires_at: number;
    }>();
    const initialCapacity = await env.DB.prepare("SELECT rows_written FROM daily_capacity").first<{
      rows_written: number;
    }>();

    const responses = await Promise.all(
      Array.from({ length: 3 }, () => SELF.fetch(`${origin}/api/session`, { headers: { Cookie: cookie } }))
    );

    expect(responses.every((response) => response.status === 200)).toBe(true);
    await expect(
      env.DB.prepare("SELECT last_active_at, expires_at FROM demo_sessions").first()
    ).resolves.toEqual(initial);
    await expect(env.DB.prepare("SELECT rows_written FROM daily_capacity").first()).resolves.toEqual(
      initialCapacity
    );

    await env.DB.prepare("UPDATE demo_sessions SET expires_at = ?")
      .bind(Date.now() + 30 * 60 * 1000)
      .run();
    const beforeRenewal = await env.DB.prepare("SELECT last_active_at, expires_at FROM demo_sessions").first<{
      last_active_at: number;
      expires_at: number;
    }>();
    const capacityBeforeRenewal = await env.DB.prepare("SELECT rows_written FROM daily_capacity").first<{
      rows_written: number;
    }>();

    const renewalResponses = await Promise.all(
      Array.from({ length: 3 }, () => SELF.fetch(`${origin}/api/session`, { headers: { Cookie: cookie } }))
    );
    expect(renewalResponses.every((response) => response.status === 200)).toBe(true);
    const renewed = await env.DB.prepare("SELECT last_active_at, expires_at FROM demo_sessions").first<{
      last_active_at: number;
      expires_at: number;
    }>();
    expect(renewed!.last_active_at).toBeGreaterThan(beforeRenewal!.last_active_at);
    expect(renewed!.expires_at).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
    await expect(env.DB.prepare("SELECT rows_written FROM daily_capacity").first()).resolves.toEqual({
      rows_written: capacityBeforeRenewal!.rows_written + 1
    });

    const absoluteExpiry = Date.now() + 30 * 60 * 1000;
    await env.DB.prepare("UPDATE demo_sessions SET expires_at = ?, absolute_expires_at = ?")
      .bind(absoluteExpiry, absoluteExpiry)
      .run();
    const beforeAbsoluteExpiryRead = await env.DB.prepare(
      "SELECT last_active_at, expires_at FROM demo_sessions"
    ).first<{ last_active_at: number; expires_at: number }>();
    const capacityBeforeAbsoluteExpiryRead = await env.DB.prepare(
      "SELECT rows_written FROM daily_capacity"
    ).first<{ rows_written: number }>();

    expect((await SELF.fetch(`${origin}/api/session`, { headers: { Cookie: cookie } })).status).toBe(200);
    await expect(
      env.DB.prepare("SELECT last_active_at, expires_at FROM demo_sessions").first()
    ).resolves.toEqual(beforeAbsoluteExpiryRead);
    await expect(env.DB.prepare("SELECT rows_written FROM daily_capacity").first()).resolves.toEqual(
      capacityBeforeAbsoluteExpiryRead
    );
  });

  it("rechaza mutaciones desde otro origen, sin Origin o con contenido que no es JSON", async () => {
    const requests = [
      SELF.fetch(`${origin}/api/session`, {
        method: "POST",
        headers: { Origin: "https://attacker.test", "Content-Type": "application/json" },
        body: JSON.stringify({ localDate: "2026-08-14" })
      }),
      SELF.fetch(`${origin}/api/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ localDate: "2026-08-14" })
      }),
      sessionRequest({ method: "POST", body: "localDate=2026-08-14" })
    ];

    await expect(
      Promise.all(requests).then((responses) => responses.map((response) => response.status))
    ).resolves.toEqual([403, 403, 415]);
    await expect(
      env.DB.prepare("SELECT count(*) AS count FROM demo_sessions").first<{ count: number }>()
    ).resolves.toEqual({ count: 0 });
  });

  it("limita la ráfaga de creación de Sesiones demo por IP sin mutar tras alcanzar el máximo", async () => {
    const headers = { "CF-Connecting-IP": "203.0.113.1", "Content-Type": "application/json" };
    const responses = await Promise.all(
      Array.from({ length: 3 }, () =>
        sessionRequest({
          method: "POST",
          headers,
          body: JSON.stringify({ localDate: "2026-08-14" })
        })
      )
    );

    expect(responses.filter((response) => response.status === 201)).toHaveLength(2);
    const limited = responses.find((response) => response.status === 429);
    expect(limited?.headers.get("Retry-After")).toBe("60");
    await expect(
      env.DB.prepare("SELECT count(*) AS count FROM demo_sessions").first<{ count: number }>()
    ).resolves.toEqual({ count: 2 });
  });

  it("el cron elimina Sesiones demo expiradas", async () => {
    const created = await sessionRequest({
      method: "POST",
      headers: { "CF-Connecting-IP": "198.51.100.4", "Content-Type": "application/json" },
      body: JSON.stringify({ localDate: "2026-08-14" })
    });
    expect(created.status).toBe(201);
    await env.DB.prepare("UPDATE demo_sessions SET expires_at = ?")
      .bind(Date.now() - 1)
      .run();

    await worker.scheduled(createScheduledController(), env);

    await expect(
      env.DB.prepare("SELECT count(*) AS count FROM demo_sessions").first<{ count: number }>()
    ).resolves.toEqual({ count: 0 });
  });

  it("crea Hábitos ordenados y establece Cumplidos idempotentes", async () => {
    const created = await sessionRequest({
      method: "POST",
      headers: { "CF-Connecting-IP": "198.51.100.5", "Content-Type": "application/json" },
      body: JSON.stringify({ localDate: "2026-08-14" })
    });
    const cookie = created.headers.get("Set-Cookie")!.split(";")[0];

    const habit = await SELF.fetch(`${origin}/api/habits`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "water", name: "Beber agua", type: "bueno", label: "Este día sí bebí agua" })
    });
    expect(habit.status).toBe(201);

    const firstSet = await SELF.fetch(`${origin}/api/habits/water/completions/2026-08-14`, {
      method: "PUT",
      headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ completed: true, localDate: "2026-08-14" })
    });
    const secondSet = await SELF.fetch(`${origin}/api/habits/water/completions/2026-08-14`, {
      method: "PUT",
      headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ completed: true, localDate: "2026-08-14" })
    });

    await expect(firstSet.json()).resolves.toMatchObject({
      habits: expect.arrayContaining([expect.objectContaining({ id: "water", position: 5 })]),
      completions: expect.arrayContaining([expect.objectContaining({ habitId: "water", date: "2026-08-14" })])
    });
    await expect(secondSet.json()).resolves.toMatchObject({
      completions: expect.arrayContaining([expect.objectContaining({ habitId: "water", date: "2026-08-14" })])
    });
    await expect(
      env.DB.prepare("SELECT count(*) AS count FROM completions WHERE habit_id = 'water'").first<{
        count: number;
      }>()
    ).resolves.toEqual({ count: 1 });
  });

  it("rechaza Cumplidos para una fecha posterior al día civil local", async () => {
    const created = await sessionRequest({
      method: "POST",
      headers: { "CF-Connecting-IP": "198.51.100.13", "Content-Type": "application/json" },
      body: JSON.stringify({ localDate: "2026-08-14" })
    });
    const cookie = created.headers.get("Set-Cookie")!.split(";")[0];

    const response = await SELF.fetch(`${origin}/api/habits/example-reading/completions/2026-08-15`, {
      method: "PUT",
      headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ completed: true, localDate: "2026-08-14" })
    });

    expect(response.status).toBe(400);
    await expect(
      env.DB.prepare("SELECT count(*) AS count FROM completions WHERE habit_id = ? AND date = ?")
        .bind("example-reading", "2026-08-15")
        .first<{ count: number }>()
    ).resolves.toEqual({ count: 0 });
  });

  it("normaliza nombres, conserva historial al editar y elimina el Hábito con sus Cumplidos", async () => {
    const created = await sessionRequest({
      method: "POST",
      headers: { "CF-Connecting-IP": "198.51.100.8", "Content-Type": "application/json" },
      body: JSON.stringify({ localDate: "2026-08-14" })
    });
    const cookie = created.headers.get("Set-Cookie")!.split(";")[0];
    const headers = { Cookie: cookie, Origin: origin, "Content-Type": "application/json" };

    const added = await SELF.fetch(`${origin}/api/habits`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: "water", name: "  Beber   agua  ", type: "bueno" })
    });
    await expect(added.json()).resolves.toMatchObject({
      habits: expect.arrayContaining([
        expect.objectContaining({ id: "water", name: "Beber   agua", label: "Este día sí Beber   agua" })
      ])
    });
    const duplicate = await SELF.fetch(`${origin}/api/habits`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: "duplicate", name: "beber agua", type: "malo" })
    });
    expect(duplicate.status).toBe(409);

    await SELF.fetch(`${origin}/api/habits/water/completions/2026-08-14`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ completed: true, localDate: "2026-08-14" })
    });
    const edited = await SELF.fetch(`${origin}/api/habits/water`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ name: "Tomar agua", type: "malo", label: "Este día no tomé agua" })
    });
    await expect(edited.json()).resolves.toMatchObject({
      habits: expect.arrayContaining([expect.objectContaining({ id: "water", type: "malo" })]),
      completions: expect.arrayContaining([expect.objectContaining({ habitId: "water", date: "2026-08-14" })])
    });
    const deleted = await SELF.fetch(`${origin}/api/habits/water`, { method: "DELETE", headers });
    await expect(deleted.json()).resolves.toMatchObject({
      habits: expect.not.arrayContaining([expect.objectContaining({ id: "water" })]),
      completions: expect.not.arrayContaining([expect.objectContaining({ habitId: "water" })])
    });
  });

  it("repone los Hábitos de ejemplo sin duplicar los existentes", async () => {
    const created = await sessionRequest({
      method: "POST",
      headers: { "CF-Connecting-IP": "198.51.100.6", "Content-Type": "application/json" },
      body: JSON.stringify({ localDate: "2026-08-14" })
    });
    const cookie = created.headers.get("Set-Cookie")!.split(";")[0];
    await env.DB.exec("DELETE FROM habits");

    const restored = await SELF.fetch(`${origin}/api/habits/examples`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
      body: "{}"
    });
    expect(restored.status).toBe(200);
    await expect(restored.json()).resolves.toMatchObject({
      habits: expect.arrayContaining([expect.objectContaining({ id: "example-reading", position: 0 })])
    });
  });

  it("repone un ejemplo renombrado sin colisionar con su ID preservado", async () => {
    const created = await sessionRequest({
      method: "POST",
      headers: { "CF-Connecting-IP": "198.51.100.7", "Content-Type": "application/json" },
      body: JSON.stringify({ localDate: "2026-08-14" })
    });
    const cookie = created.headers.get("Set-Cookie")!.split(";")[0];
    await env.DB.prepare("UPDATE habits SET name = ?, normalized_name = ? WHERE id = ?")
      .bind("Lectura nocturna", "lectura nocturna", "example-reading")
      .run();

    const restored = await SELF.fetch(`${origin}/api/habits/examples`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
      body: "{}"
    });

    expect(restored.status).toBe(200);
    await expect(restored.json()).resolves.toMatchObject({
      habits: expect.arrayContaining([expect.objectContaining({ name: "Leer 30 minutos" })])
    });
  });

  it("importa un Respaldo v1 de forma sustitutiva y no muta ante una revisión obsoleta", async () => {
    const created = await sessionRequest({
      method: "POST",
      headers: { "CF-Connecting-IP": "198.51.100.9", "Content-Type": "application/json" },
      body: JSON.stringify({ localDate: "2026-08-14" })
    });
    const cookie = created.headers.get("Set-Cookie")!.split(";")[0];
    const headers = { Cookie: cookie, Origin: origin, "Content-Type": "application/json" };
    const body = {
      revision: 0,
      backup: {
        version: 1,
        exportedAt: "2026-08-14T12:00:00.000Z",
        habits: [
          {
            id: "imported-id",
            name: "Meditar",
            label: "Este día sí medité",
            type: "bueno"
          }
        ],
        completions: { "imported-id": { "2026-08-14": true } }
      }
    };

    const imported = await SELF.fetch(`${origin}/api/import`, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
    expect(imported.status).toBe(200);
    await expect(imported.json()).resolves.toMatchObject({
      revision: 1,
      habits: [expect.objectContaining({ id: "imported-id", name: "Meditar" })],
      completions: [{ habitId: "imported-id", date: "2026-08-14" }]
    });

    const conflict = await SELF.fetch(`${origin}/api/import`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        revision: 0,
        backup: {
          version: 1,
          exportedAt: "2026-08-14T12:00:00.000Z",
          habits: [{ id: "stale", name: "Yoga", label: "Este día sí practiqué yoga", type: "bueno" }],
          completions: {}
        }
      })
    });
    expect(conflict.status).toBe(409);
    await expect(
      env.DB.prepare("SELECT revision FROM demo_sessions").first<{ revision: number }>()
    ).resolves.toEqual({ revision: 1 });
    await expect(env.DB.prepare("SELECT name FROM habits").all<{ name: string }>()).resolves.toEqual({
      results: [{ name: "Meditar" }],
      success: true,
      meta: expect.any(Object)
    });
  });

  it("reinicia los datos iniciales de la misma Sesión demo con la revisión confirmada", async () => {
    const created = await sessionRequest({
      method: "POST",
      headers: { "CF-Connecting-IP": "198.51.100.10", "Content-Type": "application/json" },
      body: JSON.stringify({ localDate: "2026-08-14" })
    });
    const cookie = created.headers.get("Set-Cookie")!.split(";")[0];
    const headers = { Cookie: cookie, Origin: origin, "Content-Type": "application/json" };

    await SELF.fetch(`${origin}/api/habits`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: "water", name: "Beber agua", type: "bueno", label: "Este día sí bebí agua" })
    });
    const reset = await SELF.fetch(`${origin}/api/reset`, {
      method: "POST",
      headers,
      body: JSON.stringify({ revision: 1 })
    });

    expect(reset.status).toBe(200);
    await expect(reset.json()).resolves.toMatchObject({
      revision: 2,
      habits: expect.arrayContaining([expect.objectContaining({ id: "example-reading" })]),
      completions: expect.arrayContaining([{ habitId: "example-reading", date: "2026-08-14" }])
    });
    await expect(env.DB.prepare("SELECT id FROM demo_sessions").all()).resolves.toMatchObject({
      results: [expect.any(Object)]
    });
  });

  it("conserva IDs importados especiales como datos dentro del Respaldo", async () => {
    const created = await sessionRequest({
      method: "POST",
      headers: { "CF-Connecting-IP": "198.51.100.11", "Content-Type": "application/json" },
      body: JSON.stringify({ localDate: "2026-08-14" })
    });
    const cookie = created.headers.get("Set-Cookie")!.split(";")[0];
    const headers = { Cookie: cookie, Origin: origin, "Content-Type": "application/json" };
    const backup = JSON.parse(`{
      "version": 1,
      "exportedAt": "2026-08-14T12:00:00.000Z",
      "habits": [{"id":"__proto__","name":"Respirar","label":"Este día sí respiré","type":"bueno"}],
      "completions": {"__proto__":{"2026-08-14":true}}
    }`);

    const imported = await SELF.fetch(`${origin}/api/import`, {
      method: "POST",
      headers,
      body: JSON.stringify({ revision: 0, backup })
    });
    expect(imported.status).toBe(200);

    const exported = await SELF.fetch(`${origin}/api/backup`, { headers: { Cookie: cookie } });
    expect(exported.status).toBe(200);
    await expect(exported.json()).resolves.toMatchObject({
      version: 1,
      completions: { __proto__: { "2026-08-14": true } }
    });
  });
});
