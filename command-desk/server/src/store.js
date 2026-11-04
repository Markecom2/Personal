// Small JSON file for state that must survive restarts: handled items, ticked plan steps, last plan.
import fs from "node:fs";
import path from "node:path";

const FILE = path.resolve(process.env.DATA_DIR || "./data", "state.json");
let state = { handled: {}, ticks: {}, triage: null, triageAt: 0 };

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
  setTicks(key, steps) { if (steps.length) state.ticks[key] = steps; else delete state.ticks[key]; save(); },
  setTriage(t) { state.triage = t; state.triageAt = Date.now(); save(); }
};
