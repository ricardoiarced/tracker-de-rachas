import { z } from "zod";

export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }, "Debe ser una fecha civil válida.");

const habitIdSchema = z.string().min(1).max(128);
const habitTextSchema = z.string().trim().min(1).max(80);
const labelSchema = z.string().trim().min(1).max(160);

export function normalizeHabitName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export const createSessionSchema = z
  .object({
    localDate: localDateSchema
  })
  .strict();

export const habitSchema = z
  .object({
    id: habitIdSchema,
    name: habitTextSchema,
    label: labelSchema,
    type: z.enum(["bueno", "malo"]),
    position: z.number().int().nonnegative()
  })
  .strict();

export const completionSchema = z
  .object({
    habitId: z.string(),
    date: localDateSchema
  })
  .strict();

export const createHabitSchema = z
  .object({
    id: habitIdSchema,
    name: habitTextSchema,
    label: labelSchema.optional(),
    type: z.enum(["bueno", "malo"])
  })
  .strict();

export const updateHabitSchema = z
  .object({
    name: habitTextSchema,
    label: labelSchema.optional(),
    type: z.enum(["bueno", "malo"])
  })
  .strict();

export const setCompletionSchema = z
  .object({
    completed: z.boolean(),
    localDate: localDateSchema
  })
  .strict();

const backupHabitSchema = habitSchema.omit({ position: true });
const backupCompletionsSchema = z
  .custom<Record<string, Record<string, true>>>(
    (value) => typeof value === "object" && value !== null && !Array.isArray(value),
    "Debe ser un objeto de Cumplidos."
  )
  .superRefine((completions, context) => {
    for (const [habitId, dates] of Object.entries(completions)) {
      if (
        !habitIdSchema.safeParse(habitId).success ||
        typeof dates !== "object" ||
        dates === null ||
        Array.isArray(dates)
      ) {
        context.addIssue({ code: "custom", path: [habitId], message: "Cumplidos inválidos." });
        continue;
      }
      for (const [date, completed] of Object.entries(dates)) {
        if (!localDateSchema.safeParse(date).success || completed !== true) {
          context.addIssue({ code: "custom", path: [habitId, date], message: "Cumplido inválido." });
        }
      }
    }
  });

export const backupV1Schema = z
  .object({
    version: z.literal(1),
    exportedAt: z.string().datetime(),
    habits: z.array(backupHabitSchema).max(25),
    completions: backupCompletionsSchema
  })
  .strict()
  .superRefine((backup, context) => {
    const habitIds = new Set<string>();
    const names = new Set<string>();
    for (const [index, habit] of backup.habits.entries()) {
      if (habitIds.has(habit.id)) {
        context.addIssue({
          code: "custom",
          path: ["habits", index, "id"],
          message: "ID de Hábito duplicado."
        });
      }
      habitIds.add(habit.id);
      if (names.has(normalizeHabitName(habit.name))) {
        context.addIssue({
          code: "custom",
          path: ["habits", index, "name"],
          message: "Nombre de Hábito duplicado."
        });
      }
      names.add(normalizeHabitName(habit.name));
    }

    let completionCount = 0;
    for (const [habitId, dates] of Object.entries(backup.completions)) {
      if (!habitIds.has(habitId)) {
        context.addIssue({ code: "custom", path: ["completions", habitId], message: "Cumplido sin Hábito." });
      }
      completionCount += Object.keys(dates).length;
    }
    if (completionCount > 20_000) {
      context.addIssue({ code: "custom", path: ["completions"], message: "Demasiados Cumplidos." });
    }
  });

export const replaceSessionSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    backup: backupV1Schema
  })
  .strict();

export const resetSessionSchema = z
  .object({
    revision: z.number().int().nonnegative()
  })
  .strict();

export const sessionSnapshotSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    session: z
      .object({
        expiresAt: z.string().datetime()
      })
      .strict(),
    habits: z.array(habitSchema),
    completions: z.array(completionSchema)
  })
  .strict();

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type BackupV1 = z.infer<typeof backupV1Schema>;
export type CreateHabitInput = z.infer<typeof createHabitSchema>;
export type ReplaceSessionInput = z.infer<typeof replaceSessionSchema>;
export type SessionSnapshot = z.infer<typeof sessionSnapshotSchema>;
export type UpdateHabitInput = z.infer<typeof updateHabitSchema>;
