// Small JSON file for state that must survive restarts: handled items, ticked plan steps, last plan.
import fs from "node:fs";
import path from "node:path";

const FILE = path.resolve(process.env.DATA_DIR || "./data", "state.json");
let state = { handled: {}, ticks: {}, triage: null, triageAt: 0, planner: {}, buckets: {}, tasks: null };

try { state = { ...state, ...JSON.parse(fs.readFileSync(FILE, "utf8")) }; } catch { /* first run */ }

let timer = null;
function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE + ".tmp", JSON.stringify(state));
      fs.renameSync(FILE + ".tmp", FILE);
    } catch (e) { console.error("state save failed:", e.message); }
  }, 300);
}

export const store = {
  get: () => state,
  setHandled(key, done) {
    if (done) state.handled[key] = Date.now(); else delete state.handled[key];
    const cut = Date.now() - 21 * 864e5;
    for (const k in state.handled) if (state.handled[k] < cut) delete state.handled[k];
    save();
  },
  // Which priority bucket you put an incoming task in. Kept across days until you move it; old entries expire.
  setBucket(key, letter) {
    state.buckets ||= {};
    if (letter) state.buckets[key] = { L: letter, at: Date.now() }; else delete state.buckets[key];
    const cut = Date.now() - 60 * 864e5;
    for (const k in state.buckets) if (state.buckets[k].at < cut) delete state.buckets[k];
    save();
  },
  // A new message on a thread you already sorted or handled puts it back in Unread.
  reopen(items) {
    let changed = false;
    for (const i of items) {
      const t = Number(i.activity) || 0; if (!t) continue;
      if (state.handled[i.key] && state.handled[i.key] < t) { delete state.handled[i.key]; changed = true; }
      if (state.buckets?.[i.key] && state.buckets[i.key].at < t) { delete state.buckets[i.key]; changed = true; }
    }
    if (changed) save();
    return changed;
  },
  // Your own to-do list. day is "YYYY-MM-DD" (shown on that day and every day after until done) or "" for someday.
  // ref is the email, Slack message or Monday item a task came from.
  tasks() {
    if (!Array.isArray(state.tasks)) {
      // First run: bring over tasks from the old per-day planner (unfinished ones, and the last week's finished ones).
      const cut = Date.now() - 7 * 864e5, seen = new Set(), out = [];
      for (const [day, doc] of Object.entries(state.planner || {}).sort().reverse()) for (const t of doc.tasks || []) {
        if (seen.has(t.id) || (t.done && !(t.doneAt > cut))) continue;
        seen.add(t.id);
        out.push({ id: t.id, text: t.text, day, top: t.abc === "A", done: !!t.done, doneAt: t.doneAt || 0, ref: "", note: "", createdAt: t.doneAt || Date.now() });
      }
      state.tasks = out; save();
    }
    return state.tasks;
  },
  saveTask(id, patch) {
    const list = this.tasks();
    let t = id && list.find((x) => x.id === id);
    if (!t) {
      if (!patch.text) return null;
      t = { id: id || "p:" + Math.random().toString(36).slice(2, 10), text: "", day: "", top: false, done: false, doneAt: 0, ref: "", note: "", createdAt: Date.now() };
      list.push(t);
    }
    if ("done" in patch && patch.done !== t.done) t.doneAt = patch.done ? Date.now() : 0;
    Object.assign(t, patch);
    if (!t.text) t.text = "(untitled)";
    // Keep finished tasks for 30 days and the list under 500.
    const cut = Date.now() - 30 * 864e5;
    state.tasks = list.filter((x) => !(x.done && x.doneAt < cut)).slice(-500);
    save();
    return t;
  },
  removeTask(id) { state.tasks = this.tasks().filter((x) => x.id !== id); save(); },
  setTicks(key, steps) { if (steps.length) state.ticks[key] = steps; else delete state.ticks[key]; save(); },
  setTriage(t) { state.triage = t; state.triageAt = Date.now(); save(); },
  // Daily planner (Eat That Frog): one doc per date "YYYY-MM-DD".
  planDoc(date) {
    state.planner ||= {};
    return state.planner[date] || { frog: null, frogTitle: "", frogDone: false, frogDoneAt: 0, abc: {}, order: {}, tasks: [], notes: "", focus: [] };
  },
  patchPlan(date, patch) {
    state.planner ||= {};
    const doc = { ...this.planDoc(date), ...patch, updatedAt: Date.now() };
    state.planner[date] = doc;
    const dates = Object.keys(state.planner).sort();
    while (dates.length > 90) delete state.planner[dates.shift()];
    save();
    return doc;
  },
  // Consecutive days (ending today, or yesterday if today's frog isn't eaten yet) with the frog eaten.
  frogStreak(today) {
    const p = state.planner || {};
    let d = new Date(today + "T12:00:00Z"), n = 0;
    if (!p[today]?.frogDone) d.setUTCDate(d.getUTCDate() - 1);
    while (p[d.toISOString().slice(0, 10)]?.frogDone) { n++; d.setUTCDate(d.getUTCDate() - 1); }
    return n;
  }
};
