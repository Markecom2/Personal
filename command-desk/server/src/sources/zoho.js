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

export async function listMails(acct) {
  const j = await call(`/accounts/${acct.id}/messages/view?limit=40`);
  return (j.data || []).map((m) => ({
    key: "e:" + m.messageId, source: "email", account: { id: acct.id, email: acct.email }, msgId: String(m.messageId),
    from: ent(m.sender || m.fromAddress), fromAddr: m.fromAddress || "", subject: ent(m.subject) || "(no subject)",
    preview: String(m.summary || "").replace(/\s+/g, " ").trim(), time: Number(m.receivedTime) || 0,
    unread: String(m.status) === "0", important: ["1", "2"].includes(String(m.priority))
  }));
}

export async function reply(item, text) {
  return call(`/accounts/${item.account.id}/messages/${item.msgId}`, {
    method: "POST",
    body: JSON.stringify({ action: "reply", fromAddress: item.account.email, toAddress: item.fromAddr, content: text, mailFormat: "plaintext" })
  });
}
