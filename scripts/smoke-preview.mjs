const origin = "https://registro-de-habitos-preview.daily-habit-tracker.workers.dev";
const localDate = new Date().toISOString().slice(0, 10);
const sessionResponse = await fetch(`${origin}/api/session`, {
  method: "POST",
  headers: { Origin: origin, "Content-Type": "application/json" },
  body: JSON.stringify({ localDate }),
  redirect: "error"
});

if (sessionResponse.status !== 201) {
  throw new Error(`Expected preview session creation to return 201, received ${sessionResponse.status}.`);
}

const cookie = sessionResponse.headers.get("set-cookie");
if (!cookie) throw new Error("Preview session creation did not return its session cookie.");

const habitResponse = await fetch(`${origin}/api/habits`, {
  method: "POST",
  headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" },
  body: JSON.stringify({ id: crypto.randomUUID(), name: "Smoke test", label: "Smoke test", type: "bueno" }),
  redirect: "error"
});

if (habitResponse.status !== 201) {
  throw new Error(`Expected preview Habit creation to return 201, received ${habitResponse.status}.`);
}
