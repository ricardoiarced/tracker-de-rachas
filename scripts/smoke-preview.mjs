const url = "https://registro-de-habitos-preview.daily-habit-tracker.workers.dev/api/session";
const response = await fetch(url, { redirect: "error" });

if (response.status !== 401) {
  throw new Error(`Expected ${url} to reject an anonymous request with 401, received ${response.status}.`);
}
