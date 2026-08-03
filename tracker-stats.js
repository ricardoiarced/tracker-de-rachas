(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TrackerStats = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function dateKey(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function streak(completions, todayStart) {
    let best = 0, run = 0;
    const start = new Date(todayStart);
    start.setDate(start.getDate() - 730);
    for (let d = new Date(todayStart); d >= start; d.setDate(d.getDate() - 1)) {
      if (completions[dateKey(d)]) { run++; if (run > best) best = run; }
      else run = 0;
    }
    let current = 0;
    let d = new Date(todayStart);
    if (!completions[dateKey(d)]) d.setDate(d.getDate() - 1);
    if (completions[dateKey(d)]) {
      while (completions[dateKey(d)]) { current++; d.setDate(d.getDate() - 1); }
    }
    return { current, best };
  }

  function weekCount(completions, dates, todayStart) {
    let done = 0, total = 0;
    for (const d of dates) {
      if (d <= todayStart) { total++; if (completions[dateKey(d)]) done++; }
    }
    return { done, total };
  }

  function computeStats(state) {
    const { habits, completions, todayStart } = state;
    const byType = (t) => habits.filter((h) => h.type === t);
    const isDone = (h, d) => !!(completions[h.id] || {})[dateKey(d)];

    let topCurrent = null, bestEver = null;
    for (const h of habits) {
      const s = streak(completions[h.id] || {}, todayStart);
      if (!topCurrent || s.current > topCurrent.current) topCurrent = { name: h.name, current: s.current };
      if (!bestEver || s.best > bestEver.best) bestEver = { name: h.name, best: s.best };
    }

    const dow = (todayStart.getDay() + 6) % 7;
    const elapsed = dow + 1;
    const monday = new Date(todayStart);
    monday.setDate(monday.getDate() - dow);

    function perfectFor(type) {
      const list = byType(type);
      if (!list.length) return null;
      let count = 0;
      for (let d = new Date(monday); d <= todayStart; d.setDate(d.getDate() + 1)) {
        if (list.every((h) => isDone(h, d))) count++;
      }
      return count;
    }

    function todayDoneFor(type) {
      const list = byType(type);
      if (!list.length) return null;
      return { done: list.filter((h) => isDone(h, todayStart)).length, total: list.length };
    }

    const bueno = todayDoneFor("bueno");
    const malo = todayDoneFor("malo");
    return {
      topCurrent,
      bestEver,
      elapsed,
      perfect: { bueno: perfectFor("bueno"), malo: perfectFor("malo") },
      todayDone: { bueno, malo },
      todayTotal: (bueno ? bueno.done : 0) + (malo ? malo.done : 0)
    };
  }

  return { streak, weekCount, computeStats, dateKey };
});