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

// "several" adds the workspace name to each message when more than one account is connected.
export async function recentMessages(acct, several = false) {
  const since = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10); // "after:" is exclusive of that day
  const j = await call(acct, "search.messages", { query: `after:${since}`, sort: "timestamp", sort_dir: "desc", count: "30" });
  const cutoff = Date.now() - 24 * 3600 * 1000;
  const out = [];
  for (const m of j.messages?.matches || []) {
    const time = Math.round(parseFloat(m.ts) * 1000) || 0;
    if (time < cutoff) continue;
    const permalink = m.permalink || "";
    let text = emo(m.text || "");
    // Resolve <@U123> mentions to names, <url|label> to label.
    for (const id of [...new Set([...text.matchAll(/<@([A-Z0-9]+)>/g)].map((x) => x[1]))]) text = text.replaceAll(`<@${id}>`, "@" + await nameFor(acct, id));
    text = text.replace(/<(https?:[^>|]+)\|([^>]+)>/g, "$2 ($1)").replace(/<(https?:[^>]+)>/g, "$1").trim();
    const ch = m.channel || {};
    const place = ch.is_im ? "DM" : ch.is_mpim ? "group DM" : (ch.name || "channel");
    out.push({
      key: `s:${slug(acct.label)}:${ch.id || ""}:${m.ts}`, source: "slack", server: acct.label, channelId: ch.id, ts: m.ts,
      channel: several ? `${acct.label} · ${place}` : place,
      from: m.username && !/^U[A-Z0-9]+$/.test(m.username) ? m.username : await nameFor(acct, m.user),
      threadTs: (permalink.match(/thread_ts=([\d.]+)/) || [])[1] || m.ts, link: permalink,
      subject: (text.split("\n").find((l) => l.trim()) || "(message)").slice(0, 140), preview: text, time, unread: false
    });
  }
  return out;
}

export async function reply(item, text) {
  const acct = accounts().find((a) => a.label === item.server);
  if (!acct) throw new Error(`No Slack token for ${item.server}`);
  const body = { channel: item.channelId, text };
  if (item.threadTs) body.thread_ts = item.threadTs;
  return call(acct, "chat.postMessage", body, true);
}
