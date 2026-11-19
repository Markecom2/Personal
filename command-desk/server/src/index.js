// Command Desk server: fetches Zoho, Slack and Monday on a schedule, asks Claude to triage,
// and serves a password-protected dashboard that can draft and send replies.
import "./env.js";
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
const dateIn = (tz, offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 864e5);
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
};
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
          if (r.ok) { live.mail[a.id] = r.value; sources.push({ icon: "email", label: a.email, state: "ok", txt: `${r.value.filter((m) => m.unread).length} unread`, filter: { kind: "email", value: a.email } }); }
          else sources.push({ icon: "email", label: a.email, state: "err", txt: "problem", note: r.error, filter: { kind: "email", value: a.email } });
        }
      } else sources.push({ icon: "email", label: "Zoho", state: "err", txt: "problem", note: accts.error });
    } else sources.push({ icon: "email", label: "Zoho", state: "warn", txt: "not set up", note: "Add the Zoho keys to the server settings to load mail." });
    // Slack: every account in SLACK_ACCOUNTS (or the single SLACK_USER_TOKEN)
    let slackAccts = [];
    try { slackAccts = slack.accounts(); } catch (e) { sources.push({ icon: "slack", label: "Slack", state: "err", txt: "problem", note: e.message }); }
    if (!slackAccts.length && !sources.some((x) => x.icon === "slack")) sources.push({ icon: "slack", label: "Slack", state: "warn", txt: "not set up", note: "Add SLACK_ACCOUNTS to the server settings to load Slack." });
    const several = slackAccts.length > 1, slackItems = [];
    for (const a of slackAccts) {
      const label = several ? "Slack · " + a.label : "Slack";
      const r = await settle("Slack " + a.label, "slack", () => slack.recentMessages(a, several));
      if (r.ok) { slackItems.push(...r.value); sources.push({ icon: "slack", label, state: "ok", txt: `${r.value.length} in 24h`, filter: { kind: "slack", value: a.label } }); }
      else {
        // keep last good data for this account
        slackItems.push(...live.slack.filter((m) => m.server === a.label));
        sources.push({ icon: "slack", label, state: "err", txt: "problem", note: r.error, filter: { kind: "slack", value: a.label } });
      }
    }
    live.slack = slackItems;
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
        sources.push({ icon: "monday", label: "Monday · " + a.label, state: "ok", txt: `${r.value.tasks.length} open tasks`, title: r.value.boards.map((b) => b.name).join(", "), filter: { kind: "monday", value: a.label } });
      } else {
        // keep last good data for this account
        mon.tasks.push(...live.mon.tasks.filter((t) => t.server === a.label));
        mon.updates.push(...live.mon.updates.filter((t) => t.server === a.label));
        sources.push({ icon: "monday", label: "Monday · " + a.label, state: "err", txt: "problem", note: r.error, filter: { kind: "monday", value: a.label } });
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
      .filter((i) => !handled[i.key] && !i.promo && !(i.kind === "task" && /de-prioriti/i.test(i.status)))
      .sort((a, b) => b.time - a.time).slice(0, 90);
    if (!items.length) return;
    const ownTasks = store.planDoc(dateIn(TZ)).tasks || [];
    try { store.setTriage(await claude.triage(items, TZ, ownTasks)); live.planError = null; }
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
    triage: st.triage, triageAt: st.triageAt, handled: st.handled, ticks: st.ticks,
    today: dateIn(TZ), tomorrow: dateIn(TZ, 1),
    planner: { today: store.planDoc(dateIn(TZ)), tomorrow: store.planDoc(dateIn(TZ, 1)) },
    frogStreak: store.frogStreak(dateIn(TZ))
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
// Planner: patch today's or tomorrow's doc. Only known fields, sanitised.
app.post("/api/planner", (req, res) => {
  const date = String(req.body.date || "");
  if (![dateIn(TZ), dateIn(TZ, 1)].includes(date)) return res.status(400).json({ error: "Only today and tomorrow can be planned." });
  const p = req.body.patch || {}, out = {};
  const letter = (v) => (["A", "B", "C", "D", "E"].includes(v) ? v : null);
  if ("frog" in p) out.frog = p.frog ? String(p.frog).slice(0, 80) : null;
  if ("frogTitle" in p) out.frogTitle = String(p.frogTitle || "").slice(0, 200);
  if ("frogDone" in p) { out.frogDone = !!p.frogDone; out.frogDoneAt = p.frogDone ? Date.now() : 0; }
  if (p.abc && typeof p.abc === "object") out.abc = Object.fromEntries(Object.entries(p.abc).slice(0, 300).map(([k, v]) => [String(k).slice(0, 80), letter(v)]).filter(([, v]) => v));
  if (p.order && typeof p.order === "object") out.order = Object.fromEntries(["A", "B", "C", "D", "E"].map((l) => [l, (Array.isArray(p.order[l]) ? p.order[l] : []).slice(0, 200).map((k) => String(k).slice(0, 80))]));
  if (Array.isArray(p.tasks)) out.tasks = p.tasks.slice(0, 100).map((t) => ({
    id: /^p:[\w-]{1,40}$/.test(t.id) ? t.id : "p:" + Math.random().toString(36).slice(2, 10),
    text: String(t.text || "").slice(0, 300), abc: letter(t.abc) || "B", done: !!t.done, delegateTo: String(t.delegateTo || "").slice(0, 60),
    due: /^\d{4}-\d{2}-\d{2}$/.test(t.due || "") ? t.due : ""
  })).filter((t) => t.text.trim());
  if ("notes" in p) out.notes = String(p.notes || "").slice(0, 5000);
  if (Array.isArray(p.focus)) out.focus = p.focus.slice(-50).map((f) => ({ key: String(f.key || "").slice(0, 80), start: Number(f.start) || 0, minutes: Math.min(240, Number(f.minutes) || 0) }));
  res.json({ doc: store.patchPlan(date, out), frogStreak: store.frogStreak(dateIn(TZ)) });
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

// No file extension on purpose: the CloudPanel nginx site answers *.webp, *.png and other asset URLs itself
// from the site folder (not public/), so an image with an extension never reaches the app.
const GUIDE_PICTURE = path.join(HERE, "..", "public", "mascot", "buddha.webp");
app.get("/mascot/buddha", (req, res) => { res.type("image/webp"); res.set("Cache-Control", "private, max-age=86400"); res.sendFile(GUIDE_PICTURE); });

app.use(express.static(path.join(HERE, "..", "public"), { index: "index.html", maxAge: 0 }));

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`Command Desk on :${PORT} · refresh every ${REFRESH_MIN} min, ${WORK_START}:00-${WORK_END}:00 ${TZ}`);
  cycle(true).catch((e) => console.error("first cycle failed:", e.message));
  setInterval(() => cycle().catch((e) => console.error("cycle failed:", e.message)), REFRESH_MIN * 60000);
});
