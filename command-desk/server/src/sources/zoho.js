// Zoho Mail via OAuth refresh token (self client). Region defaults to India (.in) to match the account.
const ACCOUNTS_HOST = process.env.ZOHO_ACCOUNTS_HOST || "https://accounts.zoho.in";
const MAIL_API = process.env.ZOHO_MAIL_API || "https://mail.zoho.in/api";

let token = null, expires = 0;

export const enabled = () => !!(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET && process.env.ZOHO_REFRESH_TOKEN);

async function accessToken() {
  if (token && Date.now() < expires - 60000) return token;
  const url = new URL("/oauth/v2/token", ACCOUNTS_HOST);
  url.search = new URLSearchParams({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN, client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET, grant_type: "refresh_token"
  });
  const r = await fetch(url, { method: "POST" });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error(`Zoho sign-in failed (${j.error || r.status}). Check the Zoho keys.`);
  token = j.access_token; expires = Date.now() + (Number(j.expires_in) || 3600) * 1000;
  return token;
}

async function call(pathname, opts = {}) {
  const r = await fetch(MAIL_API + pathname, {
    ...opts,
    headers: { Authorization: `Zoho-oauthtoken ${await accessToken()}`, "Content-Type": "application/json", ...(opts.headers || {}) }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j.status && j.status.code >= 400)) throw new Error(`Zoho ${r.status}: ${j?.data?.errorCode || j?.status?.description || "request failed"}`);
  return j;
}

export async function listAccounts() {
  const j = await call("/accounts");
  return (j.data || []).map((a) => {
    const primary = Array.isArray(a.emailAddress) ? (a.emailAddress.find((e) => e.isPrimary) || a.emailAddress[0] || {}).mailId : a.emailAddress;
    return { id: String(a.accountId), email: a.primaryEmailAddress || primary || a.mailboxAddress || "Zoho mailbox" };
  });
}

const ent = (s) => String(s || "").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

// Clear marketing mail only. Anything less obvious is left for Claude to judge.
const PROMO_SENDER = /(^|[._+-])(newsletters?|marketing|promos?|promotions?|offers?|deals?|campaigns?|mailers?)([._+-]|@)/i;
const PROMO_TEXT = /\bunsubscribe\b|\b\d{1,2}% off\b|\bsale ends\b|\blimited[- ]time offer\b|\bview (this email )?in (your )?browser\b/i;
const isPromo = (addr, subject, summary) => !/^notifications@monday\.com$/i.test(addr) && (PROMO_SENDER.test(addr) || PROMO_TEXT.test(`${subject} ${summary}`));

// Monday notification emails link to the item ("dl.monday.com/boards/1/pulses/2/posts/3").
// The list call has no body, so read each one once and remember the link.
const mondayLinks = new Map();
const MONDAY_LINK = /href="(https:\/\/[\w.-]*monday\.com\/boards\/\d+\/pulses\/\d+[^"]*)"/i;
async function mondayLink(acct, m) {
  const id = String(m.messageId);
  if (mondayLinks.has(id)) return mondayLinks.get(id);
  let link = "";
  try {
    const c = await call(`/accounts/${acct.id}/folders/${m.folderId}/messages/${id}/content`);
    link = ((String(c?.data?.content || "").match(MONDAY_LINK) || [])[1] || "").replace(/&amp;/g, "&");
  } catch { return ""; } // try again next refresh
  mondayLinks.set(id, link);
  if (mondayLinks.size > 500) mondayLinks.delete(mondayLinks.keys().next().value);
  return link;
}

const toItem = (acct, m) => ({
    key: "e:" + m.messageId, source: "email", account: { id: acct.id, email: acct.email }, msgId: String(m.messageId),
    from: ent(m.sender || m.fromAddress), fromAddr: m.fromAddress || "", subject: ent(m.subject) || "(no subject)",
    preview: String(m.summary || "").replace(/\s+/g, " ").trim(), time: Number(m.receivedTime) || 0,
    unread: String(m.status) === "0", important: ["1", "2"].includes(String(m.priority)),
    promo: isPromo(String(m.fromAddress || ""), ent(m.subject), String(m.summary || ""))
});

export async function listMails(acct) {
  const j = await call(`/accounts/${acct.id}/messages/view?limit=40`);
  const links = {};
  for (const m of j.data || []) if (m.folderId && /^notifications@monday\.com$/i.test(String(m.fromAddress || ""))) links[m.messageId] = await mondayLink(acct, m);
  return (j.data || []).map((m) => ({ ...toItem(acct, m), mondayLink: links[m.messageId] || "" }));
}

// ---- Still waiting on you ----
// Emails from the last BACKLOG_DAYS sent straight to you (in To, not Cc) by someone you have emailed, or a colleague
// on your own domain, with nothing sent by you in that conversation since. Automated and marketing senders are skipped,
// so newsletters, receipts and notifications never count.
const AUTO_SENDER = /(^|[._+-])(no-?reply|do-?not-?reply|notifications?|notify|alerts?|mailer(-daemon)?|bounces?|newsletters?|digest|marketing|news|updates?|info|billing|invoices?|receipts?|statements?|hello|support|help|feedback|calendar|postmaster|system|automated)([._+-]|@)/i;
const addrs = (s) => ent(s).toLowerCase().match(/[\w.+'-]+@[\w.-]+\.[a-z]{2,}/g) || [];
const topic = (s) => ent(s).toLowerCase().replace(/^(\s*(re|fw|fwd|aw)\s*:\s*)+/i, "").replace(/\s+/g, " ").trim();
const later = (map, k, t) => { if (k && t > (map.get(k) || 0)) map.set(k, t); };

async function pages(path, cut, timeOf, max = 10) {
  const out = [];
  for (let i = 0, start = 1; i < max; i++, start += 200) {
    const p = (await call(`${path}${path.includes("?") ? "&" : "?"}limit=200&start=${start}&includeto=true`)).data || [];
    out.push(...p);
    if (p.length < 200 || Math.min(...p.map(timeOf)) < cut) break;
  }
  return out;
}

export async function waiting(acct, days = 30) {
  const cut = Date.now() - days * 864e5, me = String(acct.email).toLowerCase(), myDomain = me.split("@")[1];
  const sentAt = (m) => Number(m.sentDateInGMT) || Number(m.receivedTime) || 0;
  const inbox = await pages(`/accounts/${acct.id}/messages/view`, cut, (m) => Number(m.receivedTime) || 0);
  const sent = await pages(`/accounts/${acct.id}/messages/search?searchKey=${encodeURIComponent("in:sent")}`, cut, sentAt);
  const known = new Set(), byTopic = new Map(), byThread = new Map();
  for (const m of [...sent, ...inbox.filter((x) => String(x.fromAddress).toLowerCase() === me)]) {
    for (const a of [...addrs(m.toAddress), ...addrs(m.ccAddress)]) known.add(a);
    later(byTopic, topic(m.subject), sentAt(m)); later(byThread, m.threadId, sentAt(m));
  }
  const latest = new Map(); // one row per conversation: its newest unanswered message
  for (const m of inbox) {
    const t = Number(m.receivedTime) || 0, from = String(m.fromAddress || "").toLowerCase();
    if (t < cut || !from || from === me || !addrs(m.toAddress).includes(me)) continue;
    if (AUTO_SENDER.test(from) || /monday\.com$/.test(from)) continue;
    if (!known.has(from) && from.split("@")[1] !== myDomain) continue;
    if (Math.max(byTopic.get(topic(m.subject)) || 0, byThread.get(m.threadId) || 0) > t) continue; // you replied
    const k = m.threadId || topic(m.subject) + "|" + from;
    if (!latest.has(k) || Number(latest.get(k).receivedTime) < t) latest.set(k, m);
  }
  return [...latest.values()].map((m) => ({ ...toItem(acct, m), waiting: true }));
}

export async function reply(item, text) {
  return call(`/accounts/${item.account.id}/messages/${item.msgId}`, {
    method: "POST",
    body: JSON.stringify({ action: "reply", fromAddress: item.account.email, toAddress: item.fromAddr, content: text, mailFormat: "plaintext" })
  });
}
