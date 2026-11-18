// Slack via a user token (xoxp-) so search covers DMs and replies post as Mark.
// Scopes: search:read, chat:write, users:read.
const EMOJI = { ":red_circle:": "🔴", ":large_yellow_circle:": "🟡", ":large_green_circle:": "🟢", ":new:": "🆕", ":white_check_mark:": "✅", ":warning:": "⚠️", ":fire:": "🔥" };
const emo = (s) => String(s || "").replace(/:[a-z_]+:/g, (m) => EMOJI[m] || m);

export const enabled = () => !!process.env.SLACK_USER_TOKEN;

async function call(method, params, post = false) {
  const headers = { Authorization: `Bearer ${process.env.SLACK_USER_TOKEN}` };
  const r = post
    ? await fetch(`https://slack.com/api/${method}`, { method: "POST", headers: { ...headers, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(params) })
    : await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, { headers });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`Slack ${method}: ${j.error || r.status}`);
  return j;
}

const userNames = new Map();
async function nameFor(id) {
  if (!id) return "";
  if (userNames.has(id)) return userNames.get(id);
  try {
    const j = await call("users.info", { user: id });
    const n = j.user?.profile?.real_name || j.user?.real_name || j.user?.name || id;
    userNames.set(id, n); return n;
  } catch { userNames.set(id, id); return id; }
}

export async function recentMessages() {
  const since = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10); // "after:" is exclusive of that day
  const j = await call("search.messages", { query: `after:${since}`, sort: "timestamp", sort_dir: "desc", count: "30" });
  const cutoff = Date.now() - 24 * 3600 * 1000;
  const out = [];
  for (const m of j.messages?.matches || []) {
    const time = Math.round(parseFloat(m.ts) * 1000) || 0;
    if (time < cutoff) continue;
    const permalink = m.permalink || "";
    let text = emo(m.text || "");
    // Resolve <@U123> mentions to names, <url|label> to label.
    for (const id of [...new Set([...text.matchAll(/<@([A-Z0-9]+)>/g)].map((x) => x[1]))]) text = text.replaceAll(`<@${id}>`, "@" + await nameFor(id));
    text = text.replace(/<(https?:[^>|]+)\|([^>]+)>/g, "$2 ($1)").replace(/<(https?:[^>]+)>/g, "$1").trim();
    const ch = m.channel || {};
    out.push({
      key: "s:" + m.ts, source: "slack", channelId: ch.id, ts: m.ts,
      channel: ch.is_im ? "DM" : ch.is_mpim ? "group DM" : (ch.name || "channel"),
      from: m.username && !/^U[A-Z0-9]+$/.test(m.username) ? m.username : await nameFor(m.user),
      threadTs: (permalink.match(/thread_ts=([\d.]+)/) || [])[1] || m.ts, link: permalink,
      subject: (text.split("\n").find((l) => l.trim()) || "(message)").slice(0, 140), preview: text, time, unread: false
    });
  }
  return out;
}

export async function reply(item, text) {
  const body = { channel: item.channelId, text };
  if (item.threadTs) body.thread_ts = item.threadTs;
  return call("chat.postMessage", body, true);
}
