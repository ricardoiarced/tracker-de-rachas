import { hc } from "hono/client";
import type { AppType } from "../worker";
import {
  backupV1Schema,
  sessionSnapshotSchema,
  type BackupV1,
  type SessionSnapshot
} from "../shared/contracts";

const client = hc<AppType>("/");

export async function getSession(): Promise<SessionSnapshot | null> {
  const response = await client.api.session.$get();
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("No se pudo consultar la Sesión demo.");
  return sessionSnapshotSchema.parse(await response.json());
}

export async function startSession(localDate: string): Promise<SessionSnapshot> {
  const response = await client.api.session.$post({ json: { localDate } });
  if (!response.ok) throw new Error("No se pudo preparar la Sesión demo.");
  return sessionSnapshotSchema.parse(await response.json());
}

export type HabitInput = {
  id: string;
  name: string;
  label?: string;
  type: "bueno" | "malo";
};

async function snapshotFrom(response: { ok: boolean; json: () => Promise<unknown> }) {
  if (!response.ok) throw new Error("No se pudo guardar el cambio.");
  return sessionSnapshotSchema.parse(await response.json());
}

async function backupFrom(response: { ok: boolean; json: () => Promise<unknown> }) {
  if (!response.ok) throw new Error("No se pudo preparar el Respaldo.");
  return backupV1Schema.parse(await response.json());
}

export function createHabit(input: HabitInput) {
  return client.api.habits.$post({ json: input }).then(snapshotFrom);
}

export function loadExamples() {
  return client.api.habits.examples.$post({ json: {} }).then(snapshotFrom);
}

export function updateHabit(id: string, input: Omit<HabitInput, "id">) {
  return client.api.habits[":habitId"].$patch({ param: { habitId: id }, json: input }).then(snapshotFrom);
}

export function removeHabit(id: string) {
  return client.api.habits[":habitId"].$delete({ param: { habitId: id } }).then(snapshotFrom);
}

export function setCompletion(habitId: string, date: string, completed: boolean, localDate: string) {
  return client.api.habits[":habitId"].completions[":date"]
    .$put({ param: { habitId, date }, json: { completed, localDate } })
    .then(snapshotFrom);
}

export function downloadBackup() {
  return client.api.backup.$get().then(backupFrom);
}

export function importBackup(backup: BackupV1, revision: number) {
  return client.api["import"].$post({ json: { backup, revision } }).then(snapshotFrom);
}

export function resetDemo(revision: number) {
  return client.api.reset.$post({ json: { revision } }).then(snapshotFrom);
}
