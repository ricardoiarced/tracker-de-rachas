const { test } = require("node:test");
const assert = require("node:assert");
const stats = require("./tracker-stats.js");

const TODAY = new Date(2026, 7, 3); // lunes 3 de agosto de 2026

test("streak: cuenta la racha actual hacia atras desde hoy si hoy esta cumplido", () => {
  const comps = { "2026-08-03": true, "2026-08-02": true, "2026-08-01": true };
  assert.deepStrictEqual(stats.streak(comps, TODAY), { current: 3, best: 3 });
});

test("streak: si hoy no esta cumplido, la racha actual arranca desde ayer", () => {
  const comps = { "2026-08-02": true, "2026-08-01": true, "2026-07-31": true };
  assert.deepStrictEqual(stats.streak(comps, TODAY), { current: 3, best: 3 });
});

test("streak: un dia sin cumplir rompe la racha actual", () => {
  const comps = { "2026-08-03": true, "2026-08-02": true, "2026-07-31": true, "2026-07-30": true };
  assert.deepStrictEqual(stats.streak(comps, TODAY), { current: 2, best: 2 });
});

test("streak: la mejor racha conserva el tramo historico mas largo", () => {
  const comps = {};
  for (let i = 0; i < 5; i++) comps["2026-07-2" + i] = true; // 2026-07-20..24
  comps["2026-08-03"] = true;
  comps["2026-08-02"] = true;
  assert.deepStrictEqual(stats.streak(comps, TODAY), { current: 2, best: 5 });
});

test("streak: sin cumplidos, la racha es cero", () => {
  assert.deepStrictEqual(stats.streak({}, TODAY), { current: 0, best: 0 });
});

function weekOf(monday) {
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(d);
  }
  return dates;
}

test("weekCount: solo cuenta los dias transcurridos (lunes a hoy)", () => {
  const monday = new Date(2026, 7, 3);
  const comps = { "2026-08-03": true, "2026-08-05": true, "2026-08-09": true };
  assert.deepStrictEqual(stats.weekCount(comps, weekOf(monday), TODAY), { done: 1, total: 1 });
});

test("weekCount: cuenta cumplidos de los dias transcurridos, ignora futuros", () => {
  const monday = new Date(2026, 7, 3);
  const jueves = new Date(2026, 7, 6);
  const comps = { "2026-08-03": true, "2026-08-05": true, "2026-08-06": true, "2026-08-09": true };
  assert.deepStrictEqual(stats.weekCount(comps, weekOf(monday), jueves), { done: 3, total: 4 });
});

const JUEVES = new Date(2026, 7, 6);

function rangeComps(ranges) {
  const comps = {};
  for (const [start, end] of ranges) {
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) comps[stats.dateKey(d)] = true;
  }
  return comps;
}

function mixedState() {
  const habits = [
    { id: "read", name: "Leer", type: "bueno" },
    { id: "gym", name: "Ejercicio", type: "bueno" },
    { id: "soda", name: "Tomar soda", type: "malo" }
  ];
  const completions = {
    // read: racha actual 4 (lun..jue), mejor racha 7
    read: rangeComps([
      [new Date(2026, 6, 13), new Date(2026, 6, 19)],
      [new Date(2026, 7, 3), new Date(2026, 7, 6)]
    ]),
    // gym: racha actual 3, mejor racha 4
    gym: rangeComps([
      [new Date(2026, 5, 20), new Date(2026, 5, 23)],
      [new Date(2026, 7, 3), new Date(2026, 7, 5)]
    ]),
    // soda: racha actual 4, mejor racha 5
    soda: rangeComps([
      [new Date(2026, 3, 10), new Date(2026, 3, 14)],
      [new Date(2026, 7, 3), new Date(2026, 7, 6)]
    ])
  };
  return { habits, completions, todayStart: JUEVES };
}

test("computeStats: desglosa rachas, dias perfectos y cumplido de hoy por tipo", () => {
  const st = stats.computeStats(mixedState());
  assert.deepStrictEqual(st.topCurrent, { name: "Leer", current: 4 });
  assert.deepStrictEqual(st.bestEver, { name: "Leer", best: 7 });
  assert.deepStrictEqual(st.perfect, { bueno: 3, malo: 4 });
  assert.deepStrictEqual(st.todayDone, { bueno: { done: 1, total: 2 }, malo: { done: 1, total: 1 } });
  assert.strictEqual(st.todayTotal, 2);
  assert.strictEqual(st.elapsed, 4);
});

test("computeStats: sin habitos de un tipo, no reporta perfect ni hoy para ese tipo", () => {
  const state = {
    habits: [{ id: "read", name: "Leer", type: "bueno" }],
    completions: { read: rangeComps([[new Date(2026, 7, 3), new Date(2026, 7, 6)]]) },
    todayStart: JUEVES
  };
  const st = stats.computeStats(state);
  assert.strictEqual(st.perfect.bueno, 4);
  assert.strictEqual(st.perfect.malo, null);
  assert.strictEqual(st.todayDone.malo, null);
  assert.strictEqual(st.todayTotal, 1);
});

test("computeStats: sin habitos, todo vacio", () => {
  const st = stats.computeStats({ habits: [], completions: {}, todayStart: JUEVES });
  assert.strictEqual(st.topCurrent, null);
  assert.strictEqual(st.bestEver, null);
  assert.deepStrictEqual(st.perfect, { bueno: null, malo: null });
  assert.deepStrictEqual(st.todayDone, { bueno: null, malo: null });
  assert.strictEqual(st.todayTotal, 0);
  assert.strictEqual(st.elapsed, 4);
});
