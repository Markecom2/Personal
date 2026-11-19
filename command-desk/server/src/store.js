// Small JSON file for state that must survive restarts: handled items, ticked plan steps, last plan.
import fs from "node:fs";
import path from "node:path";

const FILE = path.resolve(process.env.DATA_DIR || "./data", "state.json");
let state = { handled: {}, ticks: {}, triage: null, triageAt: 0, planner: {}, buckets: {} };

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
