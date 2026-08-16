import type { SessionSnapshot } from "../shared/contracts";

type Habit = SessionSnapshot["habits"][number];

function shiftDate(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function weekDates(today: string, offset: number) {
  const [year, month, day] = today.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const mondayOffset = (date.getDay() + 6) % 7;
  const monday = shiftDate(today, -mondayOffset + offset * 7);
  return Array.from({ length: 7 }, (_, index) => shiftDate(monday, index));
}

export function habitStats(habit: Habit, completions: Set<string>, today: string, dates: string[]) {
  const pastDates = [...completions].filter((date) => date <= today).sort();
  let record = 0;
  let run = 0;
  let previous: string | undefined;
  for (const date of pastDates) {
    run = previous && shiftDate(previous, 1) === date ? run + 1 : 1;
    record = Math.max(record, run);
    previous = date;
  }

  let current = 0;
  let date = completions.has(today) ? today : shiftDate(today, -1);
  while (completions.has(date)) {
    current += 1;
    date = shiftDate(date, -1);
  }

  const elapsedDates = dates.filter((date) => date <= today);
  const done = elapsedDates.filter((date) => completions.has(date)).length;
  return { current, record, done, total: elapsedDates.length };
}

export function allCompletions(snapshot: SessionSnapshot, habitId: string) {
  return new Set(
    snapshot.completions
      .filter((completion) => completion.habitId === habitId)
      .map((completion) => completion.date)
  );
}

export function overview(snapshot: SessionSnapshot, today: string) {
  const habits = snapshot.habits;
  const dates = weekDates(today, 0).filter((date) => date <= today);
  const byType = (type: Habit["type"]) => habits.filter((habit) => habit.type === type);
  const perfect = (type: Habit["type"]) => {
    const selected = byType(type);
    if (!selected.length) return null;
    return dates.filter((date) => selected.every((habit) => allCompletions(snapshot, habit.id).has(date)))
      .length;
  };
  const todayDone = (type: Habit["type"]) => {
    const selected = byType(type);
    if (!selected.length) return null;
    return {
      done: selected.filter((habit) => allCompletions(snapshot, habit.id).has(today)).length,
      total: selected.length
    };
  };
  const perHabit = habits.map((habit) => ({
    habit,
    ...habitStats(habit, allCompletions(snapshot, habit.id), today, dates)
  }));
  const current = perHabit.reduce<(typeof perHabit)[number] | null>(
    (best, entry) => (!best || entry.current > best.current ? entry : best),
    null
  );
  const record = perHabit.reduce<(typeof perHabit)[number] | null>(
    (best, entry) => (!best || entry.record > best.record ? entry : best),
    null
  );

  return {
    current,
    record,
    perfect: { bueno: perfect("bueno"), malo: perfect("malo") },
    todayDone: { bueno: todayDone("bueno"), malo: todayDone("malo") }
  };
}
