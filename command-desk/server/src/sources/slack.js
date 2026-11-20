// Slack via a user token (xoxp-) so search covers DMs and replies post as Mark.
// Scopes: search:read, chat:write, users:read.
const EMOJI = { ":red_circle:": "🔴", ":large_yellow_circle:": "🟡", ":large_green_circle:": "🟢", ":new:": "🆕", ":white_check_mark:": "✅", ":warning:": "⚠️", ":fire:": "🔥" };
const emo = (s) => String(s || "").replace(/:[a-z_]+:/g, (m) => EMOJI[m] || m);

// SLACK_ACCOUNTS='[{"label":"Workspace one","token":"xoxp-..."},{"label":"Workspace two","token":"xoxp-..."}]'
// A single SLACK_USER_TOKEN still works.
export function accounts() {
  let list;
  try { list = JSON.parse(process.env.SLACK_ACCOUNTS || "[]"); }
  catch { throw new Error("SLACK_ACCOUNTS is not valid JSON"); }
  const out = (Array.isArray(list) ? list : []).filter((a) => a && a.token && a.label).map((a) => ({ label: String(a.label), token: String(a.token) }));
  if (!out.length && process.env.SLACK_USER_TOKEN) out.push({ label: "Slack", token: process.env.SLACK_USER_TOKEN });
  return out;
}

// Only messages involving these people are shown (SLACK_PEOPLE="Mark,Jatin"). Direct and group DMs are always kept,
// since they are the token owner's own conversations.
const PEOPLE = (process.env.SLACK_PEOPLE || "Mark,Jatin").split(",").map((s) => s.trim()).filter(Boolean);
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NAME_RE = PEOPLE.length ? new RegExp(`\\b(${PEOPLE.map(escRe).join("|")})\\b`, "i") : null;
const TEXT_RE = PEOPLE.length ? new RegExp(`\\b(${PEOPLE.map(escRe).join("|")})\\b`) : null; // case-sensitive: "Mark", not "mark as done"

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);

async function call(acct, method, params, post = false) {
  const headers = { Authorization: `Bearer ${acct.token}` };
  const r = post
    ? await fetch(`https://slack.com/api/${method}`, { method: "POST", headers: { ...headers, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(params) })
    : await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, { headers });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`Slack ${method}: ${j.error || r.status}`);
  return j;
}

const userNames = new Map();
async function nameFor(acct, id) {
  if (!id) return "";
  const cacheKey = `${acct.label}:${id}`;
  if (userNames.has(cacheKey)) return userNames.get(cacheKey);
  try {
    const j = await call(acct, "users.info", { user: id });
    const n = j.user?.profile?.real_name || j.user?.real_name || j.user?.name || id;
    userNames.set(cacheKey, n); return n;
  } catch { userNames.set(cacheKey, id); return id; }
}

// Turn a search match into an inbox item. "several" adds the workspace name when more than one account is connected.
async function toItem(acct, m, several) {
  const permalink = m.permalink || "";
  let text = emo(m.text || "");
  // Resolve <@U123> mentions to names, <url|label> to label.
  const mentioned = [];
  for (const id of [...new Set([...text.matchAll(/<@([A-Z0-9]+)>/g)].map((x) => x[1]))]) { const n = await nameFor(acct, id); mentioned.push(n); text = text.replaceAll(`<@${id}>`, "@" + n); }
  text = text.replace(/<(https?:[^>|]+)\|([^>]+)>/g, "$2 ($1)").replace(/<(https?:[^>]+)>/g, "$1").trim();
  const ch = m.channel || {};
  const place = ch.is_im ? "DM" : ch.is_mpim ? "group DM" : (ch.name || "channel");
  const realName = m.user ? await nameFor(acct, m.user) : "";
  return {
    key: `s:${slug(acct.label)}:${ch.id || ""}:${m.ts}`, source: "slack", server: acct.label, channelId: ch.id, ts: m.ts,
    channel: several ? `${acct.label} · ${place}` : place,
    from: m.username && !/^U[A-Z0-9]+$/.test(m.username) ? m.username : realName,
    threadTs: threadOf(m), link: permalink,
    subject: (text.split("\n").find((l) => l.trim()) || "(message)").slice(0, 140), preview: text, time: Math.round(parseFloat(m.ts) * 1000) || 0, unread: false,
    _who: [m.username, realName, ...mentioned], _dm: !!(ch.is_im || ch.is_mpim)
  };
}
const threadOf = (m) => ((m.permalink || "").match(/thread_ts=([\d.]+)/) || [])[1] || m.ts;
const tidy = ({ _who, _dm, ...it }) => it;

export async function recentMessages(acct, several = false) {
  const since = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10); // "after:" is exclusive of that day
  const j = await call(acct, "search.messages", { query: `after:${since}`, sort: "timestamp", sort_dir: "desc", count: "100" });
  const cutoff = Date.now() - 24 * 3600 * 1000;
  const out = [];
  for (const m of j.messages?.matches || []) {
    if ((Math.round(parseFloat(m.ts) * 1000) || 0) < cutoff) continue;
    const it = await toItem(acct, m, several);
    if (NAME_RE && !it._dm) {
      const involved = it._who.some((n) => n && NAME_RE.test(n)) || TEXT_RE.test(it.preview);
      if (!involved) continue;
    }
    out.push(tidy(it));
  }
  return out;
}

// ---- Still waiting on you ----
// From the last BACKLOG_DAYS: messages that @mention you and DMs sent to you, where you haven't posted in that
// conversation since (the DM, or the thread). Bots and one-word thank-yous are skipped.
const ACK = /^\s*(thanks?( you)?( so much)?|thank u|thx|ty|ok(ay)?|k|cool|great|nice|perfect|noted|got it|sure|done|awesome|sounds good|no worries|all good|:[a-z0-9_+-]+:|[\u{1F300}-\u{1FAFF}\u2600-\u27BF\s])+[\s!.]*$/iu;
async function searchAll(acct, query, maxPages) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const j = await call(acct, "search.messages", { query, sort: "timestamp", sort_dir: "desc", count: "100", page: String(page) });
    out.push(...(j.messages?.matches || []));
    if (page >= (j.messages?.paging?.pages || 1)) break;
  }
  return out;
}

export async function waiting(acct, several = false, days = 30) {
  const me = (await call(acct, "auth.test", {})).user_id;
  const since = new Date(Date.now() - (days + 1) * 864e5).toISOString().slice(0, 10), cut = Date.now() - days * 864e5;
  const mine = await searchAll(acct, `from:<@${me}> after:${since}`, 5);
  const lastMine = new Map(), bump = (k, t) => { if (t > (lastMine.get(k) || 0)) lastMine.set(k, t); };
  for (const m of mine) {
    const ch = m.channel?.id, t = parseFloat(m.ts) * 1000, th = threadOf(m);
    bump(ch, t); bump(ch + ":" + th, t);
    if (th === m.ts) bump(ch + ":top", t);
  }
  const asks = [...await searchAll(acct, `<@${me}> after:${since}`, 3), ...await searchAll(acct, `is:dm after:${since}`, 5)];
  const latest = new Map(), seen = new Set();
  for (const m of asks) {
    const ch = m.channel || {}, t = parseFloat(m.ts) * 1000, th = threadOf(m);
    if (seen.has(ch.id + m.ts)) continue; seen.add(ch.id + m.ts);
    if (t < cut || m.user === me || !m.user || m.bot_id || m.subtype === "bot_message") continue;
    if (ACK.test(m.text || "")) continue;
    const dm = ch.is_im || ch.is_mpim;
    const answered = dm ? (lastMine.get(ch.id) || 0) > t
      : (lastMine.get(ch.id + ":" + th) || 0) > t || (th === m.ts && (lastMine.get(ch.id + ":top") || 0) > t);
    if (answered) continue;
    const k = dm ? ch.id : ch.id + ":" + th;
    if (!latest.has(k) || parseFloat(latest.get(k).ts) < parseFloat(m.ts)) latest.set(k, m);
  }
  const out = [];
  for (const m of latest.values()) out.push({ ...tidy(await toItem(acct, m, several)), waiting: true });
  return out;
}

export async function reply(item, text) {
  const acct = accounts().find((a) => a.label === item.server);
  if (!acct) throw new Error(`No Slack token for ${item.server}`);
  const body = { channel: item.channelId, text };
  if (item.threadTs) body.thread_ts = item.threadTs;
  return call(acct, "chat.postMessage", body, true);
}
