// Command Desk server: fetches Zoho, Slack and Monday on a schedule, asks Claude to triage,
// and serves a password-protected dashboard that can draft and send replies.
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mountAuth, requireAuth } from "./auth.js";
import { store } from "./store.js";
import * as claude from "./claude.js";
import * as zoho from "./sources/zoho.js";
import * as slack from "./sources/slack.js";
import * as monday from "./sources/monday.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TZ = process.env.TIMEZONE || "Asia/Kolkata";
const REFRESH_MIN = Math.max(15, Number(process.env.REFRESH_MINUTES) || 60);
const [WORK_START, WORK_END] = (process.env.WORK_HOURS || "7-21").split("-").map(Number);

/* ---------------- live data ---------------- */
const live = {
  accounts: [], mail: {}, slack: [], mon: { boards: [], tasks: [], updates: [] },
  sources: [], fetchedAt: 0, refreshing: null, planning: null, planError: null
};

const hourIn = (tz) => Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(new Date()));
const inWorkHours = () => { const h = hourIn(TZ); return h >= WORK_START && h < WORK_END; };

async function settle(label, icon, fn) {
  try { return { ok: true, value: await fn() }; }
  catch (e) { console.error(`[${label}]`, e.message); return { ok: false, error: e.message, label, icon }; }
}

async function refresh() {
  if (live.refreshing) return live.refreshing;
  live.refreshing = (async () => {
    const sources = [];
    // Zoho
    if (zoho.enabled()) {
      const accts = await settle("Zoho", "email", zoho.listAccounts);
      if (accts.ok) {
        live.accounts = accts.value;
        for (const a of accts.value) {
          const r = await settle("Zoho " + a.email, "email", () => zoho.listMails(a));
          if (r.ok) { live.mail[a.id] = r.value; sources.push({ icon: "email", label: a.email, state: "ok", txt: `${r.value.filter((m) => m.unread).length} unread` }); }
          else sources.push({ icon: "email", label: a.email, state: "err", txt: "problem", note: r.error });
        }
      } else sources.push({ icon: "email", label: "Zoho", state: "err", txt: "problem", note: accts.error });
    } else sources.push({ icon: "email", label: "Zoho", state: "warn", txt: "not set up", note: "Add the Zoho keys to the server settings to load mail." });
    // Slack
    if (slack.enabled()) {
      const r = await settle("Slack", "slack", slack.recentMessages);
      if (r.ok) { live.slack = r.value; sources.push({ icon: "slack", label: "Slack", state: "ok", txt: `${r.value.length} in 24h` }); }
      else sources.push({ icon: "slack", label: "Slack", state: "err", txt: "problem", note: r.error });
    } else sources.push({ icon: "slack", label: "Slack", state: "warn", txt: "not set up", note: "Add SLACK_USER_TOKEN to the server settings to load Slack." });
    // Monday: every account in MONDAY_ACCOUNTS
    let accts = [];
    try { accts = monday.accounts(); } catch (e) { sources.push({ icon: "monday", label: "Monday", state: "err", txt: "problem", note: e.message }); }
    if (!accts.length) sources.push({ icon: "monday", label: "Monday", state: "warn", txt: "not set up", note: "Add MONDAY_ACCOUNTS to the server settings to load Monday." });
    const mon = { boards: [], tasks: [], updates: [] };
    for (const [i, a] of accts.entries()) {
      const r = await settle("Monday " + a.label, "monday", () => monday.readAccount(a, i === 0));
      if (r.ok) {
        mon.boards.push(...r.value.boards.map((b) => ({ ...b, account: a.label })));
        mon.tasks.push(...r.value.tasks); mon.updates.push(...r.value.updates);
        sources.push({ icon: "monday", label: "Monday · " + a.label, state: "ok", txt: `${r.value.tasks.length} open tasks`, title: r.value.boards.map((b) => b.name).join(", ") });
      } else {
        // keep last good data for this account
        mon.tasks.push(...live.mon.tasks.filter((t) => t.server === a.label));
        mon.updates.push(...live.mon.updates.filter((t) => t.server === a.label));
        sources.push({ icon: "monday", label: "Monday · " + a.label, state: "err", txt: "problem", note: r.error });
      }
    }
    live.mon = mon;
    live.sources = sources;
    live.fetchedAt = Date.now();
  })().finally(() => { live.refreshing = null; });
  return live.refreshing;
}

function allItems() {
  return [...Object.values(live.mail).flat(), ...live.slack, ...live.mon.tasks, ...live.mon.updates];
}

async function replan() {
  if (!claude.enabled()) return;
  if (live.planning) return live.planning;
  live.planning = (async () => {
    const handled = store.get().handled;
    const items = allItems()
      .filter((i) => !handled[i.key] && !(i.kind === "task" && /de-prioriti/i.test(i.status)))
      .sort((a, b) => b.time - a.time).slice(0, 90);
    if (!items.length) return;
    try { store.setTriage(await claude.triage(items, TZ)); live.planError = null; }
    catch (e) { live.planError = e.message; console.error("[Claude]", e.message); }
  })().finally(() => { live.planning = null; });
  return live.planning;
}

async function cycle(force = false) {
  if (!force && !inWorkHours()) return;
  await refresh();
  await replan();
}

/* ---------------- web app ---------------- */
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
app.use(express.urlencoded({ extended: false, limit: "10kb" }));
app.use(express.json({ limit: "100kb" }));
app.get("/healthz", (req, res) => res.json({ ok: true }));
mountAuth(app);
app.use(requireAuth);
// Cross-site requests can't send JSON with the SameSite=Strict cookie, but double-check.
app.use("/api", (req, res, next) => (req.method === "POST" && !req.is("application/json") ? res.status(415).json({ error: "json_required" }) : next()));

function snapshot() {
  const st = store.get();
  return {
    tz: TZ, refreshMinutes: REFRESH_MIN, workHours: [WORK_START, WORK_END],
    fetchedAt: live.fetchedAt, refreshing: !!live.refreshing, planning: !!live.planning, planError: live.planError,
    claude: claude.enabled(), sources: live.sources,
    accounts: live.accounts, mail: live.mail, slack: live.slack, mon: live.mon,
    triage: st.triage, triageAt: st.triageAt, handled: st.handled, ticks: st.ticks
  };
}
const findItem = (key) => allItems().find((i) => i.key === key);

app.get("/api/state", (req, res) => res.json(snapshot()));
app.post("/api/refresh", async (req, res) => { await refresh(); res.json(snapshot()); replan(); });
app.post("/api/replan", async (req, res) => {
  if (!claude.enabled()) return res.status(400).json({ error: "Claude isn't set up on the server (ANTHROPIC_API_KEY)." });
  await replan();
  if (live.planError) return res.status(502).json({ error: live.planError, ...snapshot() });
  res.json(snapshot());
});
app.post("/api/mark", (req, res) => { store.setHandled(String(req.body.key || ""), !!req.body.done); res.json({ ok: true }); });
app.post("/api/ticks", (req, res) => {
  const steps = Array.isArray(req.body.steps) ? req.body.steps.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < 10) : [];
  store.setTicks(String(req.body.key || ""), steps); res.json({ ok: true });
});
app.post("/api/draft", async (req, res) => {
  const item = findItem(String(req.body.key || ""));
  if (!item) return res.status(404).json({ error: "That item is no longer in the list. Refresh and try again." });
  if (!claude.enabled()) return res.status(400).json({ error: "Claude isn't set up on the server." });
  const plan = (store.get().triage?.items || []).find((x) => x.id === item.key)?.plan;
  try { res.json({ text: await claude.draft({ ...item, plan }, String(req.body.instruction || "").slice(0, 500)) }); }
  catch (e) { res.status(502).json({ error: e.message }); }
});
app.post("/api/reply", async (req, res) => {
  const item = findItem(String(req.body.key || ""));
  const text = String(req.body.text || "").trim();
  if (!item) return res.status(404).json({ error: "That item is no longer in the list. Refresh and try again." });
  if (!text || text.length > 20000) return res.status(400).json({ error: "Write a reply first." });
  try {
    if (item.source === "email") await zoho.reply(item, text);
    else if (item.source === "slack") await slack.reply(item, text);
    else if (item.source === "monday") await monday.reply(item, text);
    else throw new Error("Unknown source");
    store.setHandled(item.key, true);
    console.log(`[reply] sent via ${item.source} for ${item.key}`);
    res.json({ ok: true });
  } catch (e) {
    console.error("[reply]", e.message);
    res.status(502).json({ error: `${e.message}. It may or may not have gone out; check before sending again.` });
  }
});

app.use(express.static(path.join(HERE, "..", "public"), { index: "index.html", maxAge: 0 }));

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`Command Desk on :${PORT} · refresh every ${REFRESH_MIN} min, ${WORK_START}:00-${WORK_END}:00 ${TZ}`);
  cycle(true).catch((e) => console.error("first cycle failed:", e.message));
  setInterval(() => cycle().catch((e) => console.error("cycle failed:", e.message)), REFRESH_MIN * 60000);
});
